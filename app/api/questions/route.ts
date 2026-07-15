import { and, asc, desc, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { questions } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { questionReviewSummary } from "../../lib/question-review";
import { questionValues } from "./values";

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, q = params.get("q") || "", stage = params.get("stage") || "", grade = params.get("grade") || "", textbookVersion = params.get("textbookVersion") || "", volume = params.get("volume") || "", unit = params.get("unit") || "", topic = params.get("topic") || "", type = params.get("type") || "", difficulty = params.get("difficulty") || "", status = params.get("status") || "active", knowledge = params.get("knowledge") || "", source = params.get("source") || "", region = params.get("region") || "", examType = params.get("examType") || "", year = params.get("year") || "", flag = params.get("flag") || "", issue = params.get("issue") || "", ids = [...new Set((params.get("ids") || "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100), page = Math.max(1, Number(params.get("page") || 1)), pageSize = 50, sort = params.get("sort") || "updated_desc";
  const conditions = [];
  if (q) conditions.push(or(like(questions.stem, `%${q}%`), like(questions.material, `%${q}%`), like(questions.analysis, `%${q}%`), like(questions.knowledgePoints, `%${q}%`), like(questions.tags, `%${q}%`)));
  if (ids.length) conditions.push(inArray(questions.id, ids)); if (stage) conditions.push(eq(questions.stage, stage)); if (grade) conditions.push(eq(questions.grade, grade)); if (textbookVersion) conditions.push(eq(questions.textbookVersion, textbookVersion)); if (volume) conditions.push(eq(questions.volume, volume)); if (unit) conditions.push(eq(questions.unit, unit)); if (topic) conditions.push(eq(questions.topic, topic)); if (type) conditions.push(eq(questions.questionType, type)); if (difficulty) conditions.push(eq(questions.difficulty, Number(difficulty))); if (status) conditions.push(eq(questions.status, status)); if (knowledge) conditions.push(or(like(questions.knowledgePoints, `%${knowledge}%`), like(questions.secondaryKnowledge, `%${knowledge}%`))); if (source) conditions.push(like(questions.source, `%${source}%`)); if (region) conditions.push(eq(questions.region, region)); if (examType) conditions.push(eq(questions.examType, examType)); if (year) conditions.push(eq(questions.year, Number(year)));
  if (flag === "favorite") conditions.push(eq(questions.isFavorite, true)); if (flag === "wrong") conditions.push(eq(questions.isWrong, true)); if (flag === "frequent") conditions.push(eq(questions.isFrequent, true));
  if (issue === "missing_answer") conditions.push(eq(questions.answer, ""));
  if (issue === "missing_analysis") conditions.push(eq(questions.analysis, ""));
  if (issue === "classification") conditions.push(or(eq(questions.stage, ""), eq(questions.grade, ""), eq(questions.knowledgePoints, "")));
  if (issue === "low_confidence") conditions.push(lt(questions.parseConfidence, .7));
  if (issue === "duplicate") conditions.push(sql`${questions.fingerprint} IN (SELECT fingerprint FROM questions WHERE fingerprint IS NOT NULL AND fingerprint != '' GROUP BY fingerprint HAVING COUNT(*) > 1)`);
  if (issue === "ready") conditions.push(sql`COALESCE(${questions.stem},'')!='' AND COALESCE(${questions.answer},'')!='' AND COALESCE(${questions.knowledgePoints},'')!='' AND COALESCE(${questions.parseConfidence},1)>=0.7 AND NOT (${questions.fingerprint} IN (SELECT fingerprint FROM questions WHERE fingerprint IS NOT NULL AND fingerprint!='' GROUP BY fingerprint HAVING COUNT(*)>1)) AND (CASE WHEN ${questions.questionType} IN ('单选题','多选题','判断题') THEN COALESCE(${questions.options},'')!='' ELSE COALESCE(${questions.scoringPoints},${questions.answerPoints},${questions.analysis},'')!='' END)`);
  const where = conditions.length ? and(...conditions) : undefined;
  const order = sort === "updated_asc" ? asc(questions.updatedAt) : sort === "difficulty_desc" ? desc(questions.difficulty) : sort === "difficulty_asc" ? asc(questions.difficulty) : sort === "use_count_desc" ? desc(questions.useCount) : sort === "use_count_asc" ? asc(questions.useCount) : desc(questions.updatedAt);
  const [rows, countRows, idRows, issues] = await Promise.all([
    getDb().select().from(questions).where(where).orderBy(order).limit(pageSize).offset((page - 1) * pageSize),
    getDb().select({ count: sql<number>`count(*)` }).from(questions).where(where),
    getDb().select({ id: questions.id }).from(questions).where(where).limit(300),
    questionReviewSummary(env.DB),
  ]);
  const total = Number(countRows[0]?.count || 0);
  return Response.json({ questions: rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), allIds: idRows.map((item) => item.id), filters: Object.fromEntries(params.entries()), issues });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, data = questionValues({ ...payload, recordedBy: access.name });
  if (!data.stem) return Response.json({ error: "题干不能为空" }, { status: 400 });
  const [existing] = await getDb().select({ id: questions.id, stem: questions.stem }).from(questions).where(eq(questions.fingerprint, data.fingerprint)).limit(1);
  if (existing) return Response.json({ error: "题库中已有高度相同的题目，请先核对后再保存", duplicate: existing }, { status: 409 });
  const [question] = await getDb().insert(questions).values(data).returning();
  await audit(access, "create", "question", question.id, { status: question.status });
  return Response.json({ question }, { status: 201 });
}
