import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { questions } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { questionValues } from "./values";

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const s = new URL(request.url).searchParams, q = s.get("q") || "", stage = s.get("stage") || "", grade = s.get("grade") || "", type = s.get("type") || "", difficulty = s.get("difficulty") || "", status = s.get("status") || "active", knowledge = s.get("knowledge") || "", flag = s.get("flag") || "", conditions = [];
  if (q) conditions.push(or(like(questions.stem, `%${q}%`), like(questions.analysis, `%${q}%`), like(questions.knowledgePoints, `%${q}%`)));
  if (stage) conditions.push(eq(questions.stage, stage)); if (grade) conditions.push(eq(questions.grade, grade)); if (type) conditions.push(eq(questions.questionType, type)); if (difficulty) conditions.push(eq(questions.difficulty, Number(difficulty))); if (status) conditions.push(eq(questions.status, status)); if (knowledge) conditions.push(like(questions.knowledgePoints, `%${knowledge}%`));
  if (flag === "favorite") conditions.push(eq(questions.isFavorite, true)); if (flag === "wrong") conditions.push(eq(questions.isWrong, true)); if (flag === "frequent") conditions.push(eq(questions.isFrequent, true));
  const rows = await getDb().select().from(questions).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(questions.updatedAt)).limit(300);
  return Response.json({ questions: rows });
}

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>;
  if (!String(body.stem || "").trim()) return Response.json({ error: "题干不能为空" }, { status: 400 });
  const [question] = await getDb().insert(questions).values(questionValues({ ...body, recordedBy: access.name })).returning();
  await audit(access, "create", "question", question.id, { status: question.status });
  return Response.json({ question }, { status: 201 });
}
