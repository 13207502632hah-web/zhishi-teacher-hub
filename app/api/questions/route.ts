import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { questions } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { questionValues } from "./values";

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, q = params.get("q") || "", stage = params.get("stage") || "", grade = params.get("grade") || "", type = params.get("type") || "", difficulty = params.get("difficulty") || "", status = params.get("status") || "active", knowledge = params.get("knowledge") || "", source = params.get("source") || "", region = params.get("region") || "", year = params.get("year") || "", flag = params.get("flag") || "";
  const conditions = [];
  if (q) conditions.push(or(like(questions.stem, `%${q}%`), like(questions.material, `%${q}%`), like(questions.analysis, `%${q}%`), like(questions.knowledgePoints, `%${q}%`), like(questions.tags, `%${q}%`)));
  if (stage) conditions.push(eq(questions.stage, stage)); if (grade) conditions.push(eq(questions.grade, grade)); if (type) conditions.push(eq(questions.questionType, type)); if (difficulty) conditions.push(eq(questions.difficulty, Number(difficulty))); if (status) conditions.push(eq(questions.status, status)); if (knowledge) conditions.push(or(like(questions.knowledgePoints, `%${knowledge}%`), like(questions.secondaryKnowledge, `%${knowledge}%`))); if (source) conditions.push(like(questions.source, `%${source}%`)); if (region) conditions.push(like(questions.region, `%${region}%`)); if (year) conditions.push(eq(questions.year, Number(year)));
  if (flag === "favorite") conditions.push(eq(questions.isFavorite, true)); if (flag === "wrong") conditions.push(eq(questions.isWrong, true)); if (flag === "frequent") conditions.push(eq(questions.isFrequent, true));
  const rows = await getDb().select().from(questions).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(questions.updatedAt)).limit(300);
  return Response.json({ questions: rows });
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
