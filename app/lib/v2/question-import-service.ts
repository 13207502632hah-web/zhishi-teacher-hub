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

function validateQuestions(value: unknown) {
  const questions = (value as Record<string, unknown>)?.questions; if (!Array.isArray(questions)) throw new Error("模型没有返回题目列表");
  return questions.filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).stem || "").trim()).slice(0, 300).map((item, index) => { const row = item as Record<string, unknown>, difficulty = Number(row.difficulty), confidence = Number(row.parseConfidence), confidenceText = String(row.parseConfidence || ""); return { ...row, stem: String(row.stem).trim(), sourceQuestionNumber: Number(row.sourceQuestionNumber || index + 1), questionType: String(row.questionType || "材料题"), difficulty: Number.isFinite(difficulty) ? Math.max(1, Math.min(5, difficulty)) : 3, options: Array.isArray(row.options) ? row.options.join("\n") : String(row.options || ""), parseConfidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : /高/.test(confidenceText) ? .9 : /低/.test(confidenceText) ? .4 : .65, status: "review", reviewStatus: "pending", reviewed: false, importNotes: Array.isArray(row.importNotes) ? row.importNotes.map(String) : String(row.importNotes || "").trim() ? [String(row.importNotes)] : [] } as AiQuestion; });
}

function validateAnswers(value: unknown) {
  const answers = (value as Record<string, unknown>)?.answers; if (!Array.isArray(answers)) throw new Error("模型没有返回答案列表");
  return answers.map((item) => item as Record<string, unknown>).map((row) => ({ ...row, sourceQuestionNumber: Number(row.sourceQuestionNumber || 0), answer: String(row.answer || "").trim(), answerPoints: String(row.answerPoints || "").trim(), analysis: String(row.analysis || "").trim() })).filter((row) => Number.isInteger(row.sourceQuestionNumber) && row.sourceQuestionNumber > 0 && (row.answer || row.answerPoints || row.analysis)) as AiAnswer[];
}

function objectOrNull(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function validateQuestionPage(value: unknown) { return { questions: validateQuestions(value), continuation: objectOrNull((value as Record<string, unknown>)?.continuationForPreviousQuestion) }; }
function validateAnswerPage(value: unknown) { return { answers: validateAnswers(value), continuation: objectOrNull((value as Record<string, unknown>)?.continuationForPreviousAnswer) }; }

function contentScore(value: Record<string, unknown>) {
  let total = 0;
  for (const item of [value.material, value.stem, value.options, value.subQuestions, value.answer, value.answerPoints, value.analysis]) total += JSON.stringify(item || "").length;
  return total;
}
function mergeVisualQuestions(candidates: AiQuestion[], answers: AiAnswer[]) {
  const byNumber = new Map<number, AiQuestion>();
  for (const candidate of candidates) { const number = Number(candidate.sourceQuestionNumber || 0); if (!Number.isInteger(number) || number < 1 || number > 300) continue; const current = byNumber.get(number); if (!current || contentScore(candidate) > contentScore(current)) byNumber.set(number, candidate); }
  const answerByNumber = new Map<number, AiAnswer>();
  for (const answer of answers) { const current = answerByNumber.get(answer.sourceQuestionNumber); if (!current || contentScore(answer) > contentScore(current)) answerByNumber.set(answer.sourceQuestionNumber, answer); }
  return [...byNumber.entries()].sort(([left], [right]) => left - right).map(([number, question]) => ({ ...question, ...(answerByNumber.get(number) || {}), sourceQuestionNumber: number }));
}

const mergedText = (left: unknown, right: unknown) => [...new Set([String(left || "").trim(), ...(Array.isArray(right) ? right.map(String) : String(right || "").split("\n")).map((item) => item.trim())].filter(Boolean))].join("\n");
function mergeQuestionPages(pages: Array<{ questions: AiQuestion[]; continuation: Record<string, unknown> | null }>) {
  const candidates: AiQuestion[] = []; let previous: AiQuestion | null = null;
  for (const page of pages) {
    if (previous && page.continuation) candidates.push({ ...previous, material: mergedText(previous.material, page.continuation.material), stem: mergedText(previous.stem, page.continuation.stem), options: mergedText(previous.options, page.continuation.options), subQuestions: Array.isArray(page.continuation.subQuestions) ? [...(Array.isArray(previous.subQuestions) ? previous.subQuestions : []), ...page.continuation.subQuestions] : previous.subQuestions });
    candidates.push(...page.questions);
    previous = [...page.questions].sort((left, right) => Number(left.sourceQuestionNumber || 0) - Number(right.sourceQuestionNumber || 0)).at(-1) || previous;
  }
  return candidates;
}

function mergeAnswerPages(pages: Array<{ answers: AiAnswer[]; continuation: Record<string, unknown> | null }>) {
  const candidates: AiAnswer[] = []; let previous: AiAnswer | null = null;
  for (const page of pages) {
    if (previous && page.continuation) candidates.push({ ...previous, answer: mergedText(previous.answer, page.continuation.answer), answerPoints: mergedText(previous.answerPoints, page.continuation.answerPoints), analysis: mergedText(previous.analysis, page.continuation.analysis) });
    candidates.push(...page.answers);
    previous = [...page.answers].sort((left, right) => left.sourceQuestionNumber - right.sourceQuestionNumber).at(-1) || previous;
  }
  return candidates;
}

function validatePairedQuestions(value: unknown) {
  const questions = validateQuestions(value), answered = questions.filter((item) => String(item.answer || item.answerPoints || "").trim()).length, minimum = Math.max(1, Math.ceil(questions.length * .9));
  if (answered < minimum) throw new Error(`答案卷只匹配到 ${answered}/${questions.length} 题，已自动切换其他模型重试`);
  return questions;
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
    await updateJob(access, jobId, { state: "running", stage: "recognizing", progress: 18, message: "正在拆题并识别结构" });
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
        const [questionPages, answerPages] = await Promise.all([
          Promise.all(questionImages.map((image, index) => callV2AiJson({ access, capability: "vision", jobId, promptVersion: "question-import-page-v2.4", maxTokens: 5000, timeoutMs: 25_000,
            system: "你是中小学题卷逐页结构化引擎。只提取本页可见的正式题目，完整保留原题号、共用材料、题干、全部选项和小问。若页首是上一题的续接内容，把它写入 continuationForPreviousQuestion，不要伪造题号。不要生成答案。难度输出 1-5 数字，置信度输出 0-1 数字。输出 {questions:[{sourceQuestionNumber,questionGroup,material,stem,options,subQuestions,questionType,difficulty,score,stage,grade,textbookVersion,volume,unit,topic,knowledgePoints,secondaryKnowledge,coreCompetencies,source,year,region,examType,parseConfidence,importNotes}],continuationForPreviousQuestion:{material,stem,options,subQuestions}|null}。",
            payload: { fileName: file.name, page: index + 1, totalPages: questionImages.length }, images: [image], validate: validateQuestionPage }))).then((pages) => mergeQuestionPages(pages.map((page) => page.data))),
          Promise.all(answerImages.map((image, index) => callV2AiJson({ access, capability: "vision", jobId, promptVersion: "question-answer-page-v2.4", maxTokens: 5000, timeoutMs: 25_000,
            system: "你是中小学答案卷逐页结构化引擎。只提取本页可见的原题号、答案、答题要点和解析。若页首是上一题解析的续接内容，把它写入 continuationForPreviousAnswer，不要伪造题号。不要把标题和小标题当作题目，不要补造。输出 {answers:[{sourceQuestionNumber,answer,answerPoints,analysis}],continuationForPreviousAnswer:{answer,answerPoints,analysis}|null}。",
            payload: { fileName: answerFileName, page: index + 1, totalPages: answerImages.length }, images: [image], validate: validateAnswerPage }))).then((pages) => mergeAnswerPages(pages.map((page) => page.data))),
        ]);
        const merged = mergeVisualQuestions(questionPages, answerPages); questions = answerBuffer ? validatePairedQuestions({ questions: merged }) : validateQuestions({ questions: merged }); needsImportPhase = true;
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
      await updateJob(access, jobId, { state: "queued", stage: "recognized", progress: 55, processed: questions.length, total: questions.length, checkpoint: { recognizedQuestions: questions }, message: `已识别 ${questions.length} 题，后台继续自动入库` });
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
  const questionSet = await env.DB.prepare("SELECT id,name,source_file AS sourceFile,import_report AS importReport,duplicate_report AS duplicateReport,parse_stage AS parseStage,review_progress AS reviewProgress,status,created_at AS createdAt FROM question_sets WHERE id=?").bind(questionSetId).first<Record<string, unknown>>(), rows = await env.DB.prepare("SELECT id,stem,material,question_type AS questionType,difficulty,answer,analysis,knowledge_points AS knowledgePoints,parse_confidence AS parseConfidence,review_status AS reviewStatus,status,updated_at AS updatedAt FROM questions WHERE question_set_id=? ORDER BY id LIMIT 300").bind(questionSetId).all<Record<string, unknown>>();
  return { job, questionSet: questionSet ? { ...questionSet, report: parseJsonObject(questionSet.importReport), duplicates: parseJsonObject(questionSet.duplicateReport) } : null, questions: rows.results };
}
