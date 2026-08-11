import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import type { AccessContext } from "../access";
import { parsePoliticsDocx } from "../question-import";
import { cellValueToText } from "../xlsx-compat";
import { callV2AiJson } from "./ai-router";
import { createJob, getJob, updateJob } from "./job-service";
import { parseJsonObject } from "./contracts";
import { ensureLocalQuestionVectors } from "./vector-index";
import { importQuestionSetForAccess } from "../../api/question-sets/import/route";

type AiQuestion = Record<string, unknown> & { stem: string };
const allowed = new Set(["docx", "pdf", "png", "jpg", "jpeg", "webp", "xlsx", "csv"]);
const fingerprint = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
function dataUrl(buffer: ArrayBuffer, mime: string) { const bytes = new Uint8Array(buffer); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return `data:${mime};base64,${btoa(binary)}`; }
function csvLine(line: string) { const output: string[] = []; let value = "", quoted = false; for (let index = 0; index < line.length; index++) { const character = line[index]; if (character === '"' && line[index + 1] === '"') { value += '"'; index++; } else if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { output.push(value); value = ""; } else value += character; } output.push(value); return output; }

async function textOf(file: File, buffer: ArrayBuffer, extension: string) {
  if (extension === "docx") return (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  if (extension === "csv") return new TextDecoder().decode(buffer).split(/\r?\n/).filter(Boolean).map((line) => csvLine(line).join(" | ")).join("\n");
  if (extension === "xlsx") { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); return workbook.worksheets.map((sheet) => { const rows: string[] = []; sheet.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellValueToText).join(" | "))); return `【工作表：${sheet.name}】\n${rows.join("\n")}`; }).join("\n\n"); }
  return "";
}

function validateQuestions(value: unknown) {
  const questions = (value as Record<string, unknown>)?.questions; if (!Array.isArray(questions)) throw new Error("模型没有返回题目列表");
  return questions.filter((item) => item && typeof item === "object" && String((item as Record<string, unknown>).stem || "").trim()).slice(0, 300).map((item, index) => { const row = item as Record<string, unknown>; return { ...row, stem: String(row.stem).trim(), sourceQuestionNumber: Number(row.sourceQuestionNumber || index + 1), questionType: String(row.questionType || "材料题"), difficulty: Math.max(1, Math.min(5, Number(row.difficulty || 3))), options: Array.isArray(row.options) ? row.options.join("\n") : String(row.options || ""), parseConfidence: Math.max(0, Math.min(1, Number(row.parseConfidence ?? .65))), status: "review", reviewStatus: "pending", reviewed: false, importNotes: Array.isArray(row.importNotes) ? row.importNotes.map(String) : [] } as AiQuestion; });
}

export async function createQuestionImportV2(access: AccessContext, form: FormData, operationId: string) {
  const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择题库文件"); const extension = file.name.toLowerCase().split(".").pop() || ""; if (!allowed.has(extension)) throw new Error("支持 DOCX、PDF、图片、XLSX 和 CSV"); if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("文件须非空且不超过 20MB");
  const buffer = await file.arrayBuffer(), sourceFingerprint = await fingerprint(buffer), importId = crypto.randomUUID(), storageKey = `v2/question-imports/${new Date().toISOString().slice(0, 10)}/${importId}.${extension}`, created = await createJob(access, { type: "question-import", operationId, entityType: "question_set", entityId: importId, state: "queued", stage: "uploaded", payload: { fileName: file.name, mimeType: file.type || "application/octet-stream", extension, size: file.size, sourceFingerprint, storageKey, name: String(form.get("name") || file.name.replace(/\.[^.]+$/, "")) } }); if (created.repeated) return { repeated: true, job: created.job };
  await env.FILES.put(storageKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { ownerId: String(access.id), originalName: file.name, fingerprint: sourceFingerprint } });
  return { importId: created.job.id, job: created.job, recognized: 0, questions: [] };
}

export async function processQuestionImportJobV2(access: AccessContext, jobId: string) {
  const storedJob = await env.DB.prepare("SELECT payload_json AS payloadJson FROM v2_jobs WHERE id=? AND user_id=? AND type='question-import'").bind(jobId, access.id).first<{ payloadJson: string }>(); if (!storedJob) throw new Error("题库导入任务不存在");
  const payload = parseJsonObject(storedJob.payloadJson), storageKey = String(payload.storageKey || ""), fileName = String(payload.fileName || ""), extension = String(payload.extension || "").toLowerCase(), sourceFingerprint = String(payload.sourceFingerprint || "");
  if (!storageKey || !fileName || !allowed.has(extension)) throw new Error("题库导入任务缺少原始文件信息");
  const object = await env.FILES.get(storageKey); if (!object) throw new Error("题库原始文件不存在，请重新上传");
  const buffer = await object.arrayBuffer(), file = new File([buffer], fileName, { type: String(payload.mimeType || object.httpMetadata?.contentType || "application/octet-stream") });
  try {
    await updateJob(access, jobId, { state: "running", stage: "recognizing", progress: 18, message: "正在拆题并识别结构" });
    const sourceText = await textOf(file, buffer, extension), localQuestions = extension === "docx" ? parsePoliticsDocx(sourceText, { source: file.name, sourceFile: file.name, sourceDocument: storageKey, status: "review", reviewed: false }) : [];
    let questions: AiQuestion[] = [];
    try {
      const visual = ["pdf", "png", "jpg", "jpeg", "webp"].includes(extension);
      const ai = await callV2AiJson({ access, capability: visual ? "vision" : "reasoning", jobId, promptVersion: "question-import-v2.1", maxTokens: 16000,
        system: "你是中小学试题结构化引擎。完整拆分材料、题干、选项、小问、答案与解析，识别原题号异常，分类教材、年级、章节、知识点、题型、难度、地区、年份和来源。不可补造缺失答案；缺失项写入 importNotes 并降低 parseConfidence。输出 {questions:[{sourceQuestionNumber,questionGroup,material,stem,options,subQuestions,answer,answerPoints,analysis,questionType,difficulty,score,stage,grade,textbookVersion,volume,unit,topic,knowledgePoints,secondaryKnowledge,coreCompetencies,source,year,region,examType,parseConfidence,importNotes}]}。",
        payload: visual ? { fileName: file.name, instruction: "逐页识别全部题目，包括材料共用关系和小问" } : { fileName: file.name, sourceText: sourceText.slice(0, 120_000), deterministicCandidates: localQuestions.slice(0, 120).map((item) => ({ ...item, attachments: undefined, tables: undefined })) },
        images: visual ? [dataUrl(buffer, file.type || (extension === "pdf" ? "application/pdf" : "image/jpeg"))] : undefined, validate: validateQuestions }); questions = ai.data;
    } catch (error) { if (!localQuestions.length) throw error; questions = localQuestions as AiQuestion[]; }
    if (!questions.length) throw new Error("没有识别到可校对的题目");
    const current = await getJob(access, jobId); if (current?.cancelRequested) { await updateJob(access, jobId, { state: "cancelled", stage: "cancelled", progress: current.progress, message: "任务已按请求取消" }); return { cancelled: true }; }
    const imported = await importQuestionSetForAccess(access, { name: String(payload.name || file.name.replace(/\.[^.]+$/, "")), sourceFile: file.name, sourceDocument: storageKey, sourceKey: storageKey, sourceFingerprint, questions });
    const result = await imported.json() as Record<string, unknown>; if (!imported.ok) throw new Error(String(result.error || "题目入待校对区失败"));
    const insertedQuestions = Array.isArray(result.questions) ? result.questions as Record<string, unknown>[] : [];
    await ensureLocalQuestionVectors(insertedQuestions.map((item) => ({ id: Number(item.id), text: [item.stem, item.material, item.questionType, item.stage, item.grade, item.topic, item.knowledgePoints, item.source].filter(Boolean).join("\n") })).filter((item) => item.id > 0));
    const questionSet = result.questionSet as Record<string, unknown>, report = parseJsonObject(result.report), output = { importId: jobId, questionSetId: Number(questionSet?.id || 0), report, recognized: questions.length, vectorsIndexed: insertedQuestions.length, storageKey };
    const job = await updateJob(access, jobId, { state: "waiting_review", stage: "review", progress: 78, processed: questions.length, total: questions.length, result: output, message: "拆题完成，等待逐题校对" }); return { ...output, job, questions: result.questions };
  } catch (error) { throw error instanceof Error ? error : new Error("题库导入失败"); }
}

export async function getQuestionImportV2(access: AccessContext, id: string) {
  const job = await getJob(access, id); if (!job || job.type !== "question-import") return null; const questionSetId = Number(job.result.questionSetId || 0); if (!questionSetId) return { job, questionSet: null, questions: [] };
  const questionSet = await env.DB.prepare("SELECT id,name,source_file AS sourceFile,import_report AS importReport,duplicate_report AS duplicateReport,parse_stage AS parseStage,review_progress AS reviewProgress,status,created_at AS createdAt FROM question_sets WHERE id=?").bind(questionSetId).first<Record<string, unknown>>(), rows = await env.DB.prepare("SELECT id,stem,material,question_type AS questionType,difficulty,answer,analysis,knowledge_points AS knowledgePoints,parse_confidence AS parseConfidence,review_status AS reviewStatus,status FROM questions WHERE question_set_id=? ORDER BY id LIMIT 300").bind(questionSetId).all<Record<string, unknown>>();
  return { job, questionSet: questionSet ? { ...questionSet, report: parseJsonObject(questionSet.importReport), duplicates: parseJsonObject(questionSet.duplicateReport) } : null, questions: rows.results };
}
