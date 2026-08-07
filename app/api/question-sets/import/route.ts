import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { papers, questions, questionSets } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { questionFingerprint } from "../../../lib/question-fingerprint";
import { summarizeImport } from "../../../lib/question-import";
import {
  buildSourceQuestionRefs,
  collectSimilarityCandidates,
  exactDuplicateRows,
  scanSimilarityCandidates,
  uniqueSourceRefs,
} from "../../../lib/question-import-candidates";
import { questionValues } from "../../questions/values";

export const QUESTION_SET_IMPORT_LIMIT = 300;

export async function POST(request: Request) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const body = await request.json() as { name?: string; sourceFile?: string; sourceDocument?: string; sourceKey?: string; sourceFingerprint?: string; questions?: Array<Record<string, unknown>> }, parsed = (body.questions || []).filter((question) => String(question.stem || "").trim());
  if (parsed.length > QUESTION_SET_IMPORT_LIMIT) {
    return Response.json({ error: `单个导入任务最多 ${QUESTION_SET_IMPORT_LIMIT} 题；本次识别到 ${parsed.length} 题，请拆分文件或分批导入`, total: parsed.length, limit: QUESTION_SET_IMPORT_LIMIT }, { status: 422 });
  }
  const input = parsed;
  if (!input.length) return Response.json({ error: "没有可导入的题目；请确认 Word 中包含文字版题号与题干" }, { status: 400 });
  let sourceFingerprint = "";
  const sourceKey = String(body.sourceKey || body.sourceDocument || "").trim();
  if (sourceKey) {
    const stored = await env.FILES.get(sourceKey);
    if (!stored) return Response.json({ error: "原始 Word 文件不存在或已过期，请重新上传后导入" }, { status: 422 });
    const serverFingerprint = String(stored.customMetadata?.fingerprint || "").trim();
    if (!serverFingerprint) return Response.json({ error: "原始 Word 文件缺少服务端指纹，请重新上传后再导入" }, { status: 422 });
    const clientFingerprint = String(body.sourceFingerprint || "").trim();
    if (clientFingerprint && clientFingerprint !== serverFingerprint) {
      return Response.json({ error: "原始 Word 文件指纹与上传记录不一致，请刷新后重新上传", expected: serverFingerprint, received: clientFingerprint }, { status: 409 });
    }
    sourceFingerprint = serverFingerprint;
  }
  if (!sourceFingerprint) sourceFingerprint = questionFingerprint({ stem: body.sourceFile || body.name || "Word 导入", material: input.map((question) => questionFingerprint(question)).join("|") });
  const db = getDb();
  const [previous] = await db.select({ id: questionSets.id, name: questionSets.name, status: questionSets.status }).from(questionSets).where(eq(questionSets.sourceFingerprint, sourceFingerprint)).limit(1);
  if (previous) return Response.json({ error: "这份 Word 文件已经导入过，避免重复入库", existing: previous }, { status: 409 });
  const sourceRefs = buildSourceQuestionRefs(input, (question) => ({
    ...questionValues({ ...question, source: question.source || body.sourceFile || "Word 试卷导入", sourceFile: body.sourceFile || "", status: "review", recordedBy: access.name }),
    reviewed: Boolean(question.reviewed),
  }));
  const prepared = sourceRefs.map((ref) => ref.prepared);
  const fingerprints = [...new Set(prepared.map((question) => question.fingerprint))], existingRows = fingerprints.length ? await db.select({ fingerprint: questions.fingerprint }).from(questions).where(inArray(questions.fingerprint, fingerprints)) : [], existing = new Set(existingRows.map((question) => question.fingerprint).filter((value): value is string => Boolean(value)));
  const unique = uniqueSourceRefs(sourceRefs).filter((ref) => !existing.has(ref.fingerprint));
  if (!unique.length) return Response.json({ error: "所有题目都与现有题库重复，未创建导入任务", duplicates: prepared.length }, { status: 409 });
  const duplicateRows = exactDuplicateRows(sourceRefs, existing);
  const { candidates: comparisonPool, coverage: similarityCoverage } = await collectSimilarityCandidates(env.DB, unique);
  const similarRows = scanSimilarityCandidates(unique, comparisonPool);
  const duplicateReport = { exact: duplicateRows, similar: similarRows, coverage: similarityCoverage };
  const summary = summarizeImport(unique.map((ref) => ({ ...ref.prepared, sourceIndex: ref.sourceIndex, sourceQuestionNumber: ref.sourceQuestionNumber ?? undefined })));
  const report = { total: prepared.length, imported: unique.length, duplicates: prepared.length - unique.length, similar: similarRows.length, coverage: similarityCoverage, reviewed: unique.filter((ref) => ref.prepared.reviewed).length, incomplete: summary.incomplete, lowConfidence: summary.lowConfidence, typeCounts: summary.typeCounts, incompleteItems: summary.incompleteItems, lowConfidenceItems: summary.lowConfidenceItems, numberingIssues: summary.numberingIssues };
  const first = unique[0].prepared, sourceYear = String(first.year || ""), academicYear = /^20\d{2}-20\d{2}$/.test(sourceYear) ? sourceYear : /^20\d{2}$/.test(sourceYear) ? `${Number(sourceYear) - 1}-${sourceYear}` : "", [paper] = await db.insert(papers).values({ title: String(body.name || "Word 试卷导入"), type: String(first.examType || "完整试卷"), stage: String(first.stage || ""), grade: String(first.grade || ""), textbookVersion: String(first.textbookVersion || ""), year: Number(first.year || 0) || null, academicYear, examCategory: String(first.examType || ""), region: String(first.region || ""), source: String(body.sourceDocument || body.sourceFile || ""), parseStatus: "review", status: "draft" }).returning();
  const [set] = await db.insert(questionSets).values({ paperId: paper.id, name: String(body.name || "Word 试卷导入"), sourceFile: String(body.sourceFile || ""), sourceDocument: String(body.sourceDocument || ""), sourceFingerprint, importReport: JSON.stringify(report), duplicateReport: JSON.stringify(duplicateReport), parseStage: "review", reviewProgress: report.reviewed, status: "review" }).returning();
  const insertedQuestions = [], storedAssetKeys: string[] = [];
  try {
    const storedQuestions = await Promise.all(unique.map(async (ref) => ({ ...ref.prepared, attachments: await storeInlineAttachments(ref.prepared.attachments, sourceFingerprint, ref.sourceIndex, storedAssetKeys) })));
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

export async function GET(request: Request) {
  const access = await requirePermission("questions:read"); if (isDenied(access)) return access;
  const fingerprint = new URL(request.url).searchParams.get("sourceFingerprint")?.trim();
  if (!fingerprint) return Response.json({ error: "缺少 sourceFingerprint" }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select({ id: questionSets.id, name: questionSets.name, status: questionSets.status, sourceFile: questionSets.sourceFile, sourceDocument: questionSets.sourceDocument }).from(questionSets).where(eq(questionSets.sourceFingerprint, fingerprint)).limit(1);
  return Response.json({ existing: existing || null });
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
