import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { papers, questions, questionSets } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionFingerprint } from "../../../lib/question-fingerprint";
import { questionTextSimilarity } from "../../../lib/question-similarity";
import { questionValues } from "../../questions/values";

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { name?: string; sourceFile?: string; sourceDocument?: string; questions?: Array<Record<string, unknown>> }, input = (body.questions || []).filter((question) => String(question.stem || "").trim()).slice(0, 300);
  if (!input.length) return Response.json({ error: "没有可导入的题目；请确认 Word 中包含文字版题号与题干" }, { status: 400 });
  const sourceFingerprint = questionFingerprint({ stem: body.sourceFile || body.name || "Word 导入", material: input.map((question) => questionFingerprint(question)).join("|") }), db = getDb();
  const [previous] = await db.select({ id: questionSets.id, name: questionSets.name, status: questionSets.status }).from(questionSets).where(eq(questionSets.sourceFingerprint, sourceFingerprint)).limit(1);
  if (previous) return Response.json({ error: "这份 Word 文件已经导入过，避免重复入库", existing: previous }, { status: 409 });
  const prepared = input.map((question) => ({ ...questionValues({ ...question, source: question.source || body.sourceFile || "Word 试卷导入", sourceFile: body.sourceFile || "", status: "review", recordedBy: access.name }), reviewed: Boolean(question.reviewed) }));
  const fingerprints = [...new Set(prepared.map((question) => question.fingerprint))], existingRows = fingerprints.length ? await db.select({ fingerprint: questions.fingerprint }).from(questions).where(inArray(questions.fingerprint, fingerprints)) : [], existing = new Set(existingRows.map((question) => question.fingerprint));
  const seen = new Set<string>();
  const unique = prepared.filter((question) => { if (existing.has(question.fingerprint) || seen.has(question.fingerprint)) return false; seen.add(question.fingerprint); return true; });
  if (!unique.length) return Response.json({ error: "所有题目都与现有题库重复，未创建导入任务", duplicates: prepared.length }, { status: 409 });
  const duplicateRows = prepared.filter((question, index) => existing.has(question.fingerprint) || prepared.findIndex((candidate) => candidate.fingerprint === question.fingerprint) !== index).map((question) => ({ fingerprint: question.fingerprint, stem: question.stem.slice(0, 120) }));
  const comparisonPool = await db.select({ id: questions.id, stem: questions.stem, fingerprint: questions.fingerprint }).from(questions).limit(2000);
  const similarRows = unique.flatMap((question, sourceIndex) => comparisonPool.map((candidate) => ({ sourceIndex, sourceStem: question.stem.slice(0, 180), candidateId: candidate.id, candidateStem: candidate.stem.slice(0, 180), similarity: questionTextSimilarity(question.stem, candidate.stem), exact: candidate.fingerprint === question.fingerprint })).filter((candidate) => !candidate.exact && candidate.similarity >= .82).sort((a, b) => b.similarity - a.similarity).slice(0, 3)).filter((item) => item.similarity >= .82);
  const duplicateReport = { exact: duplicateRows, similar: similarRows };
  const report = { total: prepared.length, imported: unique.length, duplicates: prepared.length - unique.length, similar: similarRows.length, reviewed: unique.filter((question) => question.reviewed).length, incomplete: unique.filter((question) => !question.answer || !question.analysis || !question.knowledgePoints).length, lowConfidence: unique.filter((question) => Number(question.parseConfidence ?? 1) < .7).length };
  const first = unique[0], sourceYear = String(first.year || ""), academicYear = /^20\d{2}-20\d{2}$/.test(sourceYear) ? sourceYear : /^20\d{2}$/.test(sourceYear) ? `${Number(sourceYear) - 1}-${sourceYear}` : "", [paper] = await db.insert(papers).values({ title: String(body.name || "Word 试卷导入"), type: String(first.examType || "完整试卷"), stage: String(first.stage || ""), grade: String(first.grade || ""), textbookVersion: String(first.textbookVersion || ""), year: Number(first.year || 0) || null, academicYear, examCategory: String(first.examType || ""), region: String(first.region || ""), source: String(body.sourceDocument || body.sourceFile || ""), parseStatus: "review", status: "draft" }).returning();
  const [set] = await db.insert(questionSets).values({ paperId: paper.id, name: String(body.name || "Word 试卷导入"), sourceFile: String(body.sourceFile || ""), sourceDocument: String(body.sourceDocument || ""), sourceFingerprint, importReport: JSON.stringify(report), duplicateReport: JSON.stringify(duplicateReport), parseStage: "review", reviewProgress: report.reviewed, status: "review" }).returning();
  const insertedQuestions = [], storedAssetKeys: string[] = [];
  try {
    const storedQuestions = await Promise.all(unique.map(async (question, index) => ({ ...question, attachments: await storeInlineAttachments(question.attachments, sourceFingerprint, index, storedAssetKeys) })));
    for (let index = 0; index < storedQuestions.length; index += 2) {
      const inserted = await db.insert(questions).values(storedQuestions.slice(index, index + 2).map((question) => ({ ...question, questionSetId: set.id, sourceDocumentId: set.id }))).returning();
      insertedQuestions.push(...inserted);
    }
  } catch (error) {
    await db.delete(questions).where(eq(questions.questionSetId, set.id));
    await db.delete(questionSets).where(eq(questionSets.id, set.id));
    await db.delete(papers).where(eq(papers.id, paper.id));
    await Promise.all(storedAssetKeys.map((key) => env.FILES.delete(key)));
    throw error;
  }
  await audit(access, "import", "question_set", set.id, report);
  return Response.json({ questionSet: set, questions: insertedQuestions, questionCount: unique.length, report, duplicateReport }, { status: 201 });
}

async function storeInlineAttachments(value: unknown, sourceFingerprint: string, questionIndex: number, storedKeys: string[]) {
  let attachments: Array<Record<string, unknown>> = [];
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; if (Array.isArray(parsed)) attachments = parsed; } catch { return "[]"; }
  const stored = await Promise.all(attachments.map(async (attachment, attachmentIndex) => {
    const match = String(attachment.src || "").match(/^data:image\/(png|jpe?g);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return attachment;
    const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (character) => character.charCodeAt(0));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const extension = match[1].toLowerCase() === "png" ? "png" : "jpg", mimeType = extension === "png" ? "image/png" : "image/jpeg";
    const key = `question-assets/${sourceFingerprint}/${questionIndex + 1}-${attachmentIndex + 1}-${digest.slice(0, 16)}.${extension}`;
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { sourceFingerprint, questionNumber: String(questionIndex + 1) } });
    storedKeys.push(key);
    const metadata = { ...attachment };
    delete metadata.src;
    return { ...metadata, storageKey: key, mimeType, size: bytes.byteLength };
  }));
  return JSON.stringify(stored);
}
