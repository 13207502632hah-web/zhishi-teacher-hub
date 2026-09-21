import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import type { AccessContext } from "../access";
import { enrichQuestionsFromHtml, parsePoliticsDocx } from "../question-import";
import { cellValueToText } from "../xlsx-compat";
import { callV2AiJson } from "./ai-router";
import { continueBackgroundJob, createJob, getJob, updateJob } from "./job-service";
import { parseJsonObject } from "./contracts";
import { ensureLocalQuestionVectors } from "./vector-index";
import { importQuestionSetForAccess } from "../../api/v2/question-sets/import/route";

type AiQuestion = Record<string, unknown> & { stem: string };
type AiAnswer = Record<string, unknown> & { sourceQuestionNumber: number };
const allowed = new Set(["docx", "pdf", "png", "jpg", "jpeg", "webp", "xlsx", "csv"]);
const fingerprint = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
function dataUrl(buffer: ArrayBuffer, mime: string) { const bytes = new Uint8Array(buffer); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return `data:${mime};base64,${btoa(binary)}`; }
const stringList = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
function csvLine(line: string) { const output: string[] = []; let value = "", quoted = false; for (let index = 0; index < line.length; index++) { const character = line[index]; if (character === '"' && line[index + 1] === '"') { value += '"'; index++; } else if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { output.push(value); value = ""; } else value += character; } output.push(value); return output; }

async function contentOf(file: File, buffer: ArrayBuffer, extension: string) {
  if (extension === "docx") {
    const input = Buffer.from(buffer), [raw, rendered] = await Promise.all([
      mammoth.extractRawText({ buffer: input }),
      mammoth.convertToHtml({ buffer: input }),
    ]);
    return { text: raw.value, html: rendered.value };
  }
  if (extension === "csv") return { text: new TextDecoder().decode(buffer).split(/\r?\n/).filter(Boolean).map((line) => csvLine(line).join(" | ")).join("\n"), html: "" };
  if (extension === "xlsx") { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); return { text: workbook.worksheets.map((sheet) => { const rows: string[] = []; sheet.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellValueToText).join(" | "))); return `【工作表：${sheet.name}】\n${rows.join("\n")}`; }).join("\n\n"), html: "" }; }
  return { text: "", html: "" };
}

function preserveDocxVisuals(questions: AiQuestion[], localQuestions: AiQuestion[]) {
  if (!localQuestions.length) return questions;
  const byNumber = new Map(localQuestions.map((item) => [Number(item.sourceQuestionNumber || 0), item]));
  return questions.map((question, index) => {
    const local = byNumber.get(Number(question.sourceQuestionNumber || 0)) || localQuestions[index];
    if (!local) return question;
    const attachments = Array.isArray(local.attachments) ? local.attachments : [];
    const tables = Array.isArray(local.tables) ? local.tables : [];
    if (!attachments.length && !tables.length) return question;
    const notes = [...new Set([
      ...(Array.isArray(question.importNotes) ? question.importNotes.map(String) : []),
      ...(Array.isArray(local.importNotes) ? local.importNotes.map(String).filter((note) => /图片|表格|存疑/.test(note)) : []),
    ])];
    return { ...question, attachments, tables, importNotes: notes, parseConfidence: Math.min(Number(question.parseConfidence ?? .65), Number(local.parseConfidence ?? .65)) };
  });
}

type ImportedTable = {
  id: string;
  kind: string;
  title: string;
  unit: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  complete: true;
  sourcePage?: number;
  needsReview: false;
};

const chartCue = /(?:柱状图|条形图|折线图|曲线图|饼图|扇形图|统计图|数据图|统计表|图表|表格)/;
function normalizeImportedTables(value: unknown, questionNumber: number | string): ImportedTable[] {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) throw new Error(`第 ${questionNumber} 题图表结构无效，需重新识别原页`);
  return value.map((item, index) => {
    const table = objectOrNull(item);
    if (!table || !Array.isArray(table.rows)) throw new Error(`第 ${questionNumber} 题第 ${index + 1} 个图表缺少数据网格，需重新识别原页`);
    const rows = table.rows.map((row) => Array.isArray(row) ? row.map((cell) => answerText(cell)) : []).filter((row) => row.some(Boolean));
    const rowCount = Number(table.rowCount), columnCount = Number(table.columnCount);
    if (table.complete !== true || rows.length < 2 || !Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount !== rows.length || columnCount < 2 || rows.some((row) => row.length !== columnCount)) {
      throw new Error(`第 ${questionNumber} 题第 ${index + 1} 个图表数据不完整，需重新识别标题、单位、表头和全部数值`);
    }
    const kind = String(table.kind || "table").trim().toLowerCase();
    if (kind !== "table" && !rows.slice(1).flat().some((cell) => /\d/.test(cell))) throw new Error(`第 ${questionNumber} 题第 ${index + 1} 个统计图缺少数值，需重新识别原页`);
    return {
      id: String(table.id || `visual-${questionNumber}-${index + 1}`), kind, title: answerText(table.title), unit: answerText(table.unit), rows,
      rowCount, columnCount, complete: true as const, sourcePage: Number(table.sourcePage) || undefined, needsReview: false as const,
    };
  });
}

function validateQuestions(value: unknown) {
  const questions = (value as Record<string, unknown>)?.questions; if (!Array.isArray(questions)) throw new Error("模型没有返回题目列表");
  return questions.filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).stem || "").trim()).slice(0, 300).map((item, index) => {
    const row = item as Record<string, unknown>, difficulty = Number(row.difficulty), confidence = Number(row.parseConfidence), confidenceText = String(row.parseConfidence || ""), sourceQuestionNumber = Number(row.sourceQuestionNumber || index + 1), tables = normalizeImportedTables(row.tables, sourceQuestionNumber);
    const visualText = [row.material, row.stem, ...(Array.isArray(row.importNotes) ? row.importNotes : [row.importNotes])].map(answerText).join("\n");
    if (chartCue.test(visualText) && !tables.length) throw new Error(`第 ${sourceQuestionNumber} 题提到图表但未返回结构化数据，需重新识别原页`);
    return { ...row, stem: String(row.stem).trim(), sourceQuestionNumber, questionType: String(row.questionType || "材料题"), difficulty: Number.isFinite(difficulty) ? Math.max(1, Math.min(5, difficulty)) : 3, options: Array.isArray(row.options) ? row.options.join("\n") : String(row.options || ""), tables, parseConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : /高/.test(confidenceText) ? .9 : /低/.test(confidenceText) ? .4 : .65, status: "review", reviewStatus: "pending", reviewed: false, importNotes: Array.isArray(row.importNotes) ? row.importNotes.map(String) : String(row.importNotes || "").trim() ? [String(row.importNotes)] : [] } as AiQuestion;
  });
}

function validateAnswers(value: unknown) {
  const answers = (value as Record<string, unknown>)?.answers; if (!Array.isArray(answers)) throw new Error("模型没有返回答案列表");
  return answers.map((item) => item as Record<string, unknown>).map((row) => {
    const answerPoints = answerText(row.answerPoints), analysis = answerText(row.analysis), rawAnswer = answerText(row.answer);
    const answer = /^(?:示例|答案示例|参考答案|略|见解析)[：:。\s]*$/.test(rawAnswer) ? answerPoints : rawAnswer;
    return { ...row, sourceQuestionNumber: Number(row.sourceQuestionNumber || 0), answer, answerPoints, analysis };
  }).filter((row) => Number.isInteger(row.sourceQuestionNumber) && row.sourceQuestionNumber > 0 && (row.answer || row.answerPoints || row.analysis)) as AiAnswer[];
}

function objectOrNull(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
const answerText = (value: unknown): string => Array.isArray(value) ? value.map(answerText).filter(Boolean).join("\n") : String(value || "").trim();
function questionContinuation(value: unknown) {
  if (value == null) return null;
  const continuation = objectOrNull(value);
  if (!continuation || !["material", "stem", "options", "subQuestions", "tables"].some((field) => answerText(continuation[field]))) throw new Error("跨页续文缺少有效内容字段，需重新识别本页");
  const tables = normalizeImportedTables(continuation.tables, "上一");
  const visualText = [continuation.material, continuation.stem, ...(Array.isArray(continuation.importNotes) ? continuation.importNotes : [continuation.importNotes])].map(answerText).join("\n");
  if (chartCue.test(visualText) && !tables.length) throw new Error("跨页续文提到图表但未返回结构化数据，需重新识别本页");
  return { ...continuation, tables };
}
function validateQuestionPage(value: unknown) { return { questions: validateQuestions(value), continuation: questionContinuation((value as Record<string, unknown>)?.continuationForPreviousQuestion), document: objectOrNull((value as Record<string, unknown>)?.document) }; }
function validateAnswerPage(value: unknown) { return { answers: validateAnswers(value), continuation: objectOrNull((value as Record<string, unknown>)?.continuationForPreviousAnswer) }; }
function savedQuestionPages(value: unknown) { return Array.isArray(value) ? value.map((item) => objectOrNull(item)).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({ questions: validateQuestions(item), continuation: questionContinuation(item.continuation), document: objectOrNull(item.document) })) : []; }
function savedAnswerPages(value: unknown) { return Array.isArray(value) ? value.map((item) => objectOrNull(item)).filter((item): item is Record<string, unknown> => Boolean(item)).map((item) => ({ answers: validateAnswers(item), continuation: objectOrNull(item.continuation) })) : []; }

function contentScore(value: Record<string, unknown>) {
  let total = 0;
  for (const item of [value.material, value.stem, value.options, value.subQuestions, value.tables, value.answer, value.answerPoints, value.analysis]) total += JSON.stringify(item || "").length;
  return total;
}
function mergeVisualQuestions(candidates: AiQuestion[], answers: AiAnswer[]) {
  const byNumber = new Map<number, AiQuestion>();
  for (const candidate of candidates) { const number = Number(candidate.sourceQuestionNumber || 0); if (!Number.isInteger(number) || number < 1 || number > 300) continue; const current = byNumber.get(number); if (!current || contentScore(candidate) > contentScore(current)) byNumber.set(number, candidate); }
  const answerByNumber = new Map<number, AiAnswer>();
  for (const answer of answers) { const current = answerByNumber.get(answer.sourceQuestionNumber); if (!current || contentScore(answer) > contentScore(current)) answerByNumber.set(answer.sourceQuestionNumber, answer); }
  return [...byNumber.entries()].sort(([left], [right]) => left - right).map(([number, question]) => ({ ...question, ...(answerByNumber.get(number) || {}), sourceQuestionNumber: number }));
}

const mergedText = (left: unknown, right: unknown) => {
  const first = answerText(left), second = answerText(right);
  if (!first || second.includes(first)) return second;
  if (!second || first.includes(second)) return first;
  return [...new Set([...first.split("\n"), ...second.split("\n")].map((line) => line.trim()).filter(Boolean))].join("\n");
};
const realStem = (value: unknown) => {
  const stem = answerText(value);
  return /^[（(【\[]?(?:题干缺失|题目未完|题干未完|待续|续上页|题目未完整)[\s\S]*[）)】\]]?$/.test(stem) ? "" : stem;
};
function mergeQuestionFragment(left: AiQuestion, right: Record<string, unknown>): AiQuestion {
  const tables = [...(Array.isArray(left.tables) ? left.tables : []), ...(Array.isArray(right.tables) ? right.tables : [])].filter((item, index, items) => items.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index);
  return { ...left, ...right, sourceQuestionNumber: left.sourceQuestionNumber,
    stem: mergedText(realStem(left.stem), realStem(right.stem)), material: mergedText(left.material, right.material), options: mergedText(left.options, right.options),
    subQuestions: [...(Array.isArray(left.subQuestions) ? left.subQuestions : []), ...(Array.isArray(right.subQuestions) ? right.subQuestions : [])].filter((item, index, items) => items.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index),
    tables, score: Number(right.score) > 0 ? right.score : left.score,
  };
}
function mergeQuestionPages(pages: Array<{ questions: AiQuestion[]; continuation: Record<string, unknown> | null }>) {
  const candidates: AiQuestion[] = []; let previous: AiQuestion | null = null;
  for (const page of pages) {
    if (previous && page.continuation) { previous = mergeQuestionFragment(previous, page.continuation); candidates[candidates.length - 1] = previous; }
    for (const question of page.questions) {
      if (previous && Number(previous.sourceQuestionNumber) === Number(question.sourceQuestionNumber)) { previous = mergeQuestionFragment(previous, question); candidates[candidates.length - 1] = previous; }
      else { previous = question; candidates.push(question); }
    }
  }
  return candidates;
}

function finalizeQuestionPages(pages: ReturnType<typeof savedQuestionPages>) {
  const document = pages.find((page) => page.document)?.document || {};
  return mergeQuestionPages(pages).map((question) => {
    const stem = realStem(question.stem), number = question.sourceQuestionNumber, choice = /单选|多选|选择/.test(String(question.questionType || ""));
    if (!stem || !/[\p{L}\p{N}]/u.test(stem)) throw new Error(`第 ${number} 题缺少完整题干，需重新识别跨页内容`);
    if (choice && Number(document.choiceOptionCount) === 4 && !["A", "B", "C", "D"].every((letter) => new RegExp(`(?:^|\\n)\\s*${letter}[.．、:：)）\\s]`).test(String(question.options || "")))) throw new Error(`第 ${number} 题选项不完整，需重新识别跨页内容`);
    const referencedStatements = [...new Set(String(question.options || "").match(/[①②③④⑤⑥⑦⑧⑨⑩]/g) || [])];
    const statements = [stem, question.material, JSON.stringify(question.subQuestions || [])].join("\n");
    if (choice && referencedStatements.some((marker) => !statements.includes(marker))) throw new Error(`第 ${number} 题缺少组合选项对应的陈述，需重新识别原页`);
    return { ...question, stem, stage: String(document.stage || "未标注"), grade: String(document.grade || "未标注"), year: Number(document.year) || undefined, region: String(document.region || ""), score: Number(question.score) > 0 ? question.score : choice ? Number(document.choiceScore) || 0 : 0 };
  });
}

function mergeAnswerPages(pages: Array<{ answers: AiAnswer[]; continuation: Record<string, unknown> | null }>) {
  const candidates: AiAnswer[] = []; let previous: AiAnswer | null = null;
  for (const page of pages) {
    if (previous && page.continuation) { previous = { ...(previous as AiAnswer), answer: mergedText(previous.answer, page.continuation.answer), answerPoints: mergedText(previous.answerPoints, page.continuation.answerPoints), analysis: mergedText(previous.analysis, page.continuation.analysis) }; candidates.push(previous); }
    candidates.push(...page.answers);
    previous = [...page.answers].sort((left, right) => left.sourceQuestionNumber - right.sourceQuestionNumber).at(-1) || previous;
  }
  return candidates;
}

function validatePairedQuestions(value: unknown) {
  const questions = validateQuestions(value), answered = questions.filter((item) => String(item.answer || item.answerPoints || "").trim()).length, minimum = Math.max(1, Math.ceil(questions.length * .9));
  if (answered < minimum) throw new Error(`答案卷只匹配到 ${answered}/${questions.length} 题，未将不完整结果入库`);
  return questions;
}

function validatePairedQuestionNumbers(questions: AiQuestion[], answers: AiAnswer[]) {
  const numbers = new Set(questions.map((question) => Number(question.sourceQuestionNumber)));
  const missing = [...new Set(answers.map((answer) => answer.sourceQuestionNumber))].filter((number) => !numbers.has(number)).sort((a, b) => a - b);
  if (missing.length) throw new Error(`题卷与答案卷题号不一致：题卷漏识别第 ${missing.join("、")} 题，未入库`);
}

export async function createQuestionImportV2(access: AccessContext, form: FormData, operationId: string) {
  const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择题库文件"); const extension = file.name.toLowerCase().split(".").pop() || ""; if (!allowed.has(extension)) throw new Error("支持 DOCX、PDF、图片、XLSX 和 CSV"); if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("文件须非空且不超过 20MB");
  const answerFileValue = form.get("answerFile"), answerFile = answerFileValue instanceof File && answerFileValue.size ? answerFileValue : null, visualExtensions = new Set(["pdf", "png", "jpg", "jpeg", "webp"]), answerExtension = answerFile?.name.toLowerCase().split(".").pop() || "", pages = form.getAll("page").filter((item): item is File => item instanceof File), answerPages = form.getAll("answerPage").filter((item): item is File => item instanceof File);
  if (answerFile && (!visualExtensions.has(extension) || !visualExtensions.has(answerExtension))) throw new Error("题卷与答案成对导入目前支持 PDF 和图片");
  if (answerFile && answerFile.size > 20 * 1024 * 1024) throw new Error("答案文件须不超过 20MB");
  if (extension === "pdf" && !pages.length) throw new Error("PDF 尚未生成逐页识别图，请刷新页面后重新选择文件");
  if (answerExtension === "pdf" && !answerPages.length) throw new Error("答案 PDF 尚未生成逐页识别图，请刷新页面后重新选择文件");
  if (pages.length > 40 || answerPages.length > 40 || pages.length + answerPages.length > 60) throw new Error("单次导入页数过多，请拆分后导入");
  const allPages = [...pages, ...answerPages]; if (allPages.some((page) => !page.type.startsWith("image/") || !page.size || page.size > 4 * 1024 * 1024)) throw new Error("逐页识别图须为不超过 4MB 的图片");
  const buffer = await file.arrayBuffer(), answerBuffer = answerFile ? await answerFile.arrayBuffer() : null, fileFingerprint = await fingerprint(buffer), answerFingerprint = answerBuffer ? await fingerprint(answerBuffer) : "", sourceFingerprint = answerFingerprint ? await fingerprint(new TextEncoder().encode(`${fileFingerprint}:${answerFingerprint}`).buffer) : fileFingerprint, importId = crypto.randomUUID(), datePrefix = `v2/question-imports/${new Date().toISOString().slice(0, 10)}/${importId}`, storageKey = `${datePrefix}.${extension}`, answerStorageKey = answerFile ? `${datePrefix}-answer.${answerExtension}` : "", pageStorageKeys = pages.map((_, index) => `${datePrefix}-page-${String(index + 1).padStart(3, "0")}.jpg`), answerPageStorageKeys = answerPages.map((_, index) => `${datePrefix}-answer-page-${String(index + 1).padStart(3, "0")}.jpg`), created = await createJob(access, { type: "question-import", operationId, entityType: "question_set", entityId: importId, state: "queued", stage: "uploaded", payload: { fileName: file.name, mimeType: file.type || "application/octet-stream", extension, size: file.size, sourceFingerprint, storageKey, answerFileName: answerFile?.name || "", answerMimeType: answerFile?.type || "", answerExtension, answerSize: answerFile?.size || 0, answerStorageKey, pageStorageKeys, answerPageStorageKeys, name: String(form.get("name") || file.name.replace(/\.[^.]+$/, "")) } }); if (created.repeated) return { repeated: true, job: created.job };
  await Promise.all([
    env.FILES.put(storageKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { ownerId: String(access.id), originalName: file.name, fingerprint: sourceFingerprint } }),
    answerFile && answerBuffer ? env.FILES.put(answerStorageKey, answerBuffer, { httpMetadata: { contentType: answerFile.type || "application/octet-stream" }, customMetadata: { ownerId: String(access.id), originalName: answerFile.name, fingerprint: sourceFingerprint, role: "answer" } }) : Promise.resolve(),
    ...pages.map(async (page, index) => env.FILES.put(pageStorageKeys[index], await page.arrayBuffer(), { httpMetadata: { contentType: page.type }, customMetadata: { ownerId: String(access.id), originalName: page.name, fingerprint: sourceFingerprint, role: "question-page", page: String(index + 1) } })),
    ...answerPages.map(async (page, index) => env.FILES.put(answerPageStorageKeys[index], await page.arrayBuffer(), { httpMetadata: { contentType: page.type }, customMetadata: { ownerId: String(access.id), originalName: page.name, fingerprint: sourceFingerprint, role: "answer-page", page: String(index + 1) } })),
  ]);
  return { importId: created.job.id, job: created.job, recognized: 0, questions: [] };
}

export async function processQuestionImportJobV2(access: AccessContext, jobId: string, leaseOwner = "") {
  const storedJob = await env.DB.prepare("SELECT payload_json AS payloadJson FROM v2_jobs WHERE id=? AND user_id=? AND type='question-import'").bind(jobId, access.id).first<{ payloadJson: string }>(); if (!storedJob) throw new Error("题库导入任务不存在");
  const currentJob = await getJob(access, jobId); if (!currentJob) throw new Error("题库导入任务不存在");
  const payload = parseJsonObject(storedJob.payloadJson), storageKey = String(payload.storageKey || ""), fileName = String(payload.fileName || ""), extension = String(payload.extension || "").toLowerCase(), sourceFingerprint = String(payload.sourceFingerprint || ""), answerStorageKey = String(payload.answerStorageKey || ""), answerFileName = String(payload.answerFileName || ""), pageStorageKeys = stringList(payload.pageStorageKeys), answerPageStorageKeys = stringList(payload.answerPageStorageKeys);
  if (!storageKey || !fileName || !allowed.has(extension)) throw new Error("题库导入任务缺少原始文件信息");
  const object = await env.FILES.get(storageKey); if (!object) throw new Error("题库原始文件不存在，请重新上传");
  const answerObject = answerStorageKey ? await env.FILES.get(answerStorageKey) : null; if (answerStorageKey && !answerObject) throw new Error("答案原始文件不存在，请重新上传");
  const buffer = await object.arrayBuffer(), answerBuffer = answerObject ? await answerObject.arrayBuffer() : null, file = new File([buffer], fileName, { type: String(payload.mimeType || object.httpMetadata?.contentType || "application/octet-stream") });
  try {
    await updateJob(access, jobId, { state: "running", stage: "recognizing", progress: Math.max(18, currentJob.progress), message: "正在拆题并识别结构" });
    const source = await contentOf(file, buffer, extension), sourceText = source.text;
    const localQuestions = extension === "docx" ? enrichQuestionsFromHtml(source.html, parsePoliticsDocx(sourceText, { source: file.name, sourceFile: file.name, sourceDocument: storageKey, status: "review", reviewed: false })) : [];
    const visualImages = async () => {
      const fromKeys = (keys: string[]) => Promise.all(keys.map(async (key) => { const page = await env.FILES.get(key); if (!page) throw new Error("PDF 逐页识别图不完整，请重新上传"); return dataUrl(await page.arrayBuffer(), page.httpMetadata?.contentType || "image/jpeg"); }));
      const questionImages = pageStorageKeys.length ? await fromKeys(pageStorageKeys) : [dataUrl(buffer, file.type || "image/jpeg")];
      const answerImages = !answerBuffer ? [] : answerPageStorageKeys.length ? await fromKeys(answerPageStorageKeys) : [dataUrl(answerBuffer, String(payload.answerMimeType || "image/jpeg"))];
      return { questionImages, answerImages };
    };
    const checkpointQuestions = Array.isArray(currentJob.checkpoint.recognizedQuestions) ? currentJob.checkpoint.recognizedQuestions : [];
    let questions: AiQuestion[] = [], needsImportPhase = false;
    // DOCX already has a deterministic parser that preserves every numbered question,
    // image and table. Persist that result first instead of making the whole import wait
    // for a long, whole-paper AI response. Files without usable text still use AI/OCR.
    if (checkpointQuestions.length) questions = validateQuestions({ questions: checkpointQuestions });
    else if (extension === "docx" && localQuestions.length) questions = localQuestions as AiQuestion[];
    else try {
      const visual = ["pdf", "png", "jpg", "jpeg", "webp"].includes(extension);
      if (visual && (pageStorageKeys.length > 1 || answerPageStorageKeys.length > 1)) {
        const { questionImages, answerImages } = await visualImages();
        // Older checkpoints lost cross-page continuations. Re-recognize those pages
        // from the stored originals instead of importing an incomplete question.
        const pageRecognitionVersion = "source-only-v4", checkpointValid = currentJob.checkpoint.pageRecognitionVersion === pageRecognitionVersion;
        const questionPages = savedQuestionPages(checkpointValid ? currentJob.checkpoint.questionPages : []), answerPages = savedAnswerPages(checkpointValid ? currentJob.checkpoint.answerPages : []), batchSize = 1;
        if (!leaseOwner) throw new Error("后台任务缺少续跑租约");
        if (questionPages.length < questionImages.length) {
          const start = questionPages.length, batch = questionImages.slice(start, start + batchSize);
          const recognized = await Promise.all(batch.map((image, offset) => callV2AiJson({ access, capability: "vision", jobId, promptVersion: "question-import-page-v2.8", maxTokens: 7000, timeoutMs: 60_000, thinking: "disabled",
            system: "你是中小学题卷逐页抄录引擎。逐题提取本页全部正式题目，完整保留原题号、共用材料、图表文字、题干、全部选项和小问。凡题目含任何表格（包括事例—形式、名言—解读等对照表）、统计表、柱状图、条形图、折线图、曲线图、饼图或其他数据图，必须把标题、单位、表头、图例和每一个可见文字或数值抄成tables二维网格；rows第一行是表头，rowCount和columnCount必须与rows实际尺寸完全一致，全部抄完才可将complete设为true。原图没有标题或单位时对应字段留空，禁止猜测；漏一个单元格也不得返回成功。漫画、地图和示意图的全部可见文字写入material或importNotes，不要臆造数据表。不要漏掉页底尚未结束的题目，下一页会接续。页首上一题的续文写入 continuationForPreviousQuestion 的 material/stem/options/subQuestions/tables对应字段，不要自创字段或伪造题号。组合选择题的①②③④陈述写入题干，A/B/C/D写入options，小问仅用于材料题。不要生成答案、难度或推测教材知识点。分值只记录原文明确标注的值，置信度为0-1。首页同时提取原文明确的学段、适用年级、年份、地区及选择题每题分值和选项数量，不明确则留空；中考适用九年级。输出紧凑JSON {document:{stage,grade,year,region,choiceScore,choiceOptionCount}|null,questions:[{sourceQuestionNumber,material,stem,options,subQuestions,tables:[{id,kind,title,unit,rowCount,columnCount,complete,rows}],questionType,score,parseConfidence,importNotes}],continuationForPreviousQuestion:{material,stem,options,subQuestions,tables}|null}。",
            payload: { fileName: file.name, page: start + offset + 1, totalPages: questionImages.length }, images: [image], validate: validateQuestionPage })));
          questionPages.push(...recognized.map((page) => page.data));
          const completedPages = questionPages.length + answerPages.length, totalPages = questionImages.length + answerImages.length;
          await updateJob(access, jobId, { state: "queued", stage: "recognizing_pages", progress: 18 + Math.round(completedPages / Math.max(1, totalPages) * 32), processed: completedPages, total: totalPages, checkpoint: { pageRecognitionVersion, questionPages, answerPages }, message: `已识别 ${completedPages}/${totalPages} 页，后台继续` });
          if (!await continueBackgroundJob(jobId, leaseOwner)) throw new Error("后台任务续跑租约已失效");
          return { requeue: true, recognizedPages: completedPages, totalPages };
        }
        if (answerPages.length < answerImages.length) {
          const start = answerPages.length, batch = answerImages.slice(start, start + batchSize);
          const recognized = await Promise.all(batch.map((image, offset) => callV2AiJson({ access, capability: "vision", jobId, promptVersion: "question-answer-page-v2.7", maxTokens: 5000, timeoutMs: 60_000, thinking: "disabled",
            system: "你是中小学答案卷逐页抄录引擎。只提取本页可见的原题号、完整答案、答题要点和完整解析（包括原文考查点）。answer必须是实际答案全文，不能只写“示例”“略”等标题。knowledgePoints只抄录本题原文明确的“考查点”，无则留空。页首上一题解析的续文写入 continuationForPreviousAnswer，不伪造题号。不要把通用答题模板和小标题当题目，不补造、不压缩原文。输出紧凑JSON {answers:[{sourceQuestionNumber,answer,answerPoints,analysis,knowledgePoints}],continuationForPreviousAnswer:{answer,answerPoints,analysis}|null}。",
            payload: { fileName: answerFileName, page: start + offset + 1, totalPages: answerImages.length }, images: [image], validate: validateAnswerPage })));
          answerPages.push(...recognized.map((page) => page.data));
          const completedPages = questionPages.length + answerPages.length, totalPages = questionImages.length + answerImages.length;
          await updateJob(access, jobId, { state: "queued", stage: "recognizing_pages", progress: 18 + Math.round(completedPages / Math.max(1, totalPages) * 32), processed: completedPages, total: totalPages, checkpoint: { pageRecognitionVersion, questionPages, answerPages }, message: `已识别 ${completedPages}/${totalPages} 页，后台继续` });
          if (!await continueBackgroundJob(jobId, leaseOwner)) throw new Error("后台任务续跑租约已失效");
          return { requeue: true, recognizedPages: completedPages, totalPages };
        }
        const mergedQuestions = finalizeQuestionPages(questionPages), mergedAnswers = mergeAnswerPages(answerPages);
        if (answerBuffer) validatePairedQuestionNumbers(mergedQuestions, mergedAnswers);
        const merged = mergeVisualQuestions(mergedQuestions, mergedAnswers); questions = answerBuffer ? validatePairedQuestions({ questions: merged }) : validateQuestions({ questions: merged }); needsImportPhase = true;
      } else {
        const { questionImages, answerImages } = visual ? await visualImages() : { questionImages: [], answerImages: [] };
        const ai = await callV2AiJson({ access, capability: visual ? "vision" : "reasoning", jobId, promptVersion: answerBuffer ? "question-import-paired-v2.2" : "question-import-v2.1", maxTokens: 16000,
          system: "你是中小学试题结构化引擎。完整拆分材料、题干、选项、小问、答案与解析，识别原题号异常，分类教材、年级、章节、知识点、题型、难度、地区、年份和来源。如果输入包含两份文件，第一个是题卷、第二个是答案卷；必须按原题号逐题匹配答案与解析，不能把答案卷中的题号或小标题识别成新题。不可补造缺失答案；缺失项写入 importNotes 并降低 parseConfidence。输出 {questions:[{sourceQuestionNumber,questionGroup,material,stem,options,subQuestions,answer,answerPoints,analysis,questionType,difficulty,score,stage,grade,textbookVersion,volume,unit,topic,knowledgePoints,secondaryKnowledge,coreCompetencies,source,year,region,examType,parseConfidence,importNotes}]}。",
          payload: visual ? { fileName: file.name, answerFileName, fileOrder: answerBuffer ? ["题卷", "答案卷"] : ["题卷"], instruction: answerBuffer ? "逐页识别第一份题卷的全部题目，再将第二份答案卷按原题号合并到对应题目，包括材料共用关系和小问" : "逐页识别全部题目，包括材料共用关系和小问" } : { fileName: file.name, sourceText: sourceText.slice(0, 120_000), deterministicCandidates: localQuestions.slice(0, 120).map((item) => ({ ...item, attachments: undefined, tables: undefined })) },
          images: visual ? [...questionImages, ...answerImages] : undefined, validate: answerBuffer ? validatePairedQuestions : validateQuestions }); questions = extension === "docx" ? preserveDocxVisuals(ai.data, localQuestions as AiQuestion[]) : ai.data;
      }
    } catch (error) { if (!localQuestions.length) throw error; questions = localQuestions as AiQuestion[]; }
    if (!questions.length) throw new Error("没有识别到可校对的题目");
    if (needsImportPhase) {
      if (!leaseOwner) throw new Error("后台任务缺少续跑租约");
      await updateJob(access, jobId, { state: "queued", stage: "recognized", progress: 55, processed: questions.length, total: questions.length, checkpoint: { ...currentJob.checkpoint, recognizedQuestions: questions }, message: `已识别 ${questions.length} 题，后台继续自动入库` });
      if (!await continueBackgroundJob(jobId, leaseOwner)) throw new Error("后台任务续跑租约已失效");
      return { requeue: true, recognized: questions.length };
    }
    const pairedAnswerCoverage = answerBuffer ? { matched: questions.filter((item) => String(item.answer || item.answerPoints || "").trim()).length, total: questions.length } : undefined;
    const current = await getJob(access, jobId); if (current?.cancelRequested) { await updateJob(access, jobId, { state: "cancelled", stage: "cancelled", progress: current.progress, message: "任务已按请求取消" }); return { cancelled: true }; }
    const imported = await importQuestionSetForAccess(access, { name: String(payload.name || file.name.replace(/\.[^.]+$/, "")), sourceFile: answerFileName ? `${file.name} + ${answerFileName}` : file.name, sourceDocument: storageKey, sourceKey: storageKey, sourceFingerprint, questions });
    const result = await imported.json() as Record<string, unknown>;
    if (!imported.ok && imported.status === 409 && Number(result.duplicates || 0) > 0) {
      const duplicates = Number(result.duplicates), output = { importId: jobId, questionSetId: Number((result.existing as Record<string, unknown> | undefined)?.id || 0), report: { total: questions.length, imported: 0, duplicates, enriched: Number(result.enriched || 0) }, recognized: questions.length, vectorsIndexed: 0, storageKey, answerStorageKey, pairedAnswerCoverage, skippedAsDuplicate: true };
      const job = await updateJob(access, jobId, { state: "completed", stage: "completed_duplicate", progress: 100, processed: questions.length, total: questions.length, result: output, error: {}, message: `${duplicates} 道题均已存在，已跳过重复导入` });
      return { ...output, job, questions: [] };
    }
    if (!imported.ok) throw new Error(String(result.error || "题目入待校对区失败"));
    const insertedQuestions = Array.isArray(result.questions) ? result.questions as Record<string, unknown>[] : [];
    await ensureLocalQuestionVectors(insertedQuestions.map((item) => ({ id: Number(item.id), text: [item.stem, item.material, item.questionType, item.stage, item.grade, item.topic, item.knowledgePoints, item.source].filter(Boolean).join("\n") })).filter((item) => item.id > 0));
    const questionSet = result.questionSet as Record<string, unknown>, report = parseJsonObject(result.report), output = { importId: jobId, questionSetId: Number(questionSet?.id || 0), report, recognized: questions.length, vectorsIndexed: insertedQuestions.length, storageKey, answerStorageKey, pairedAnswerCoverage };
    const job = await updateJob(access, jobId, { state: "completed", stage: "completed", progress: 100, processed: questions.length, total: questions.length, result: output, error: {}, message: "已自动检查并入库，缺失字段保留提示" }); return { ...output, job, questions: result.questions };
  } catch (error) { throw error instanceof Error ? error : new Error("题库导入失败"); }
}

export async function getQuestionImportV2(access: AccessContext, id: string) {
  const job = await getJob(access, id); if (!job || job.type !== "question-import") return null; const questionSetId = Number(job.result.questionSetId || 0); if (!questionSetId) return { job, questionSet: null, questions: [] };
  const questionSet = await env.DB.prepare("SELECT id,name,source_file AS sourceFile,import_report AS importReport,duplicate_report AS duplicateReport,parse_stage AS parseStage,review_progress AS reviewProgress,status,created_at AS createdAt FROM question_sets WHERE id=?").bind(questionSetId).first<Record<string, unknown>>(), rows = await env.DB.prepare("SELECT id,stem,material,options,sub_questions AS subQuestions,tables,attachments,question_type AS questionType,difficulty,score,stage,grade,year,region,answer,answer_points AS answerPoints,analysis,knowledge_points AS knowledgePoints,notes,parse_confidence AS parseConfidence,review_status AS reviewStatus,status,created_at AS createdAt,updated_at AS updatedAt FROM questions WHERE question_set_id=? ORDER BY id LIMIT 300").bind(questionSetId).all<Record<string, unknown>>();
  const parseArray = (value: unknown) => { try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
  return { job, questionSet: questionSet ? { ...questionSet, report: parseJsonObject(questionSet.importReport), duplicates: parseJsonObject(questionSet.duplicateReport) } : null, questions: rows.results.map((row) => ({ ...row, tables: parseArray(row.tables), attachments: parseArray(row.attachments) })) };
}
