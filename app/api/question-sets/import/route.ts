import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { questions, questionSets } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionFingerprint } from "../../../lib/question-fingerprint";
import { questionValues } from "../../questions/values";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { name?: string; sourceFile?: string; questions?: Array<Record<string, unknown>> }, input = (body.questions || []).filter((question) => String(question.stem || "").trim()).slice(0, 300);
  if (!input.length) return Response.json({ error: "没有可导入的题目；请确认 Word 中包含文字版题号与题干" }, { status: 400 });
  const sourceFingerprint = questionFingerprint({ stem: body.sourceFile || body.name || "Word 导入", material: input.map((question) => questionFingerprint(question)).join("|") }), db = getDb();
  const [previous] = await db.select({ id: questionSets.id, name: questionSets.name, status: questionSets.status }).from(questionSets).where(eq(questionSets.sourceFingerprint, sourceFingerprint)).limit(1);
  if (previous) return Response.json({ error: "这份 Word 文件已经导入过，避免重复入库", existing: previous }, { status: 409 });
  const prepared = input.map((question) => ({ ...questionValues({ ...question, source: question.source || body.sourceFile || "Word 试卷导入", sourceFile: body.sourceFile || "", status: "review", recordedBy: access.name }), reviewed: Boolean(question.reviewed) }));
  const fingerprints = [...new Set(prepared.map((question) => question.fingerprint))], existingRows = fingerprints.length ? await db.select({ fingerprint: questions.fingerprint }).from(questions).where(inArray(questions.fingerprint, fingerprints)) : [], existing = new Set(existingRows.map((question) => question.fingerprint));
  const unique = prepared.filter((question) => !existing.has(question.fingerprint));
  if (!unique.length) return Response.json({ error: "所有题目都与现有题库重复，未创建导入任务", duplicates: prepared.length }, { status: 409 });
  const report = { total: prepared.length, imported: unique.length, duplicates: prepared.length - unique.length, reviewed: unique.filter((question) => question.reviewed).length, incomplete: unique.filter((question) => !question.answer || !question.analysis || !question.knowledgePoints).length };
  const [set] = await db.insert(questionSets).values({ name: String(body.name || "Word 试卷导入"), sourceFile: String(body.sourceFile || ""), sourceFingerprint, importReport: JSON.stringify(report), status: "review" }).returning();
  const insertedQuestions = [];
  try {
    for (let index = 0; index < unique.length; index += 2) {
      const inserted = await db.insert(questions).values(unique.slice(index, index + 2).map((question) => ({ ...question, questionSetId: set.id }))).returning();
      insertedQuestions.push(...inserted);
    }
  } catch (error) {
    await db.delete(questions).where(eq(questions.questionSetId, set.id));
    await db.delete(questionSets).where(eq(questionSets.id, set.id));
    throw error;
  }
  await audit(access, "import", "question_set", set.id, report);
  return Response.json({ questionSet: set, questions: insertedQuestions, questionCount: unique.length, report }, { status: 201 });
}
