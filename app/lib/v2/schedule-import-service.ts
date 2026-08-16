import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import type { AccessContext } from "../access";
import { normalizeScheduleRow, selectScheduleTable, validateNormalizedSchedule, type ScheduleMapping } from "../schedule-import";
import { inspectScheduleImportRow, loadPreviousScheduleIdentities, type NormalizedScheduleRow } from "../schedule-import-preview";
import type { ScheduleIdentityCache } from "../schedule-import-identity";
import { cellValueToText, readFirstWorksheetCompat } from "../xlsx-compat";
import { callV2AiJson } from "./ai-router";
import { parseJsonArray, parseJsonObject, type ImportRowState } from "./contracts";
import { createJob, getJob, updateJob } from "./job-service";

type PreparedRow = { rowNumber: number; sourceCell: string; raw: Record<string, unknown>; value: NormalizedScheduleRow; confidence: number; issues: string[] };
type StoredRow = { id: number; rowNumber: number; rawJson: string; normalizedJson: string; previousJson: string; state: ImportRowState; confidence: number; issuesJson: string; action: string; lessonId: number | null };
const extensions = new Set(["xlsx", "csv", "png", "jpg", "jpeg", "webp", "pdf"]);
const digest = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function parseCsvLine(line: string) {
  const result: string[] = []; let value = "", quoted = false;
  for (let index = 0; index < line.length; index++) { const character = line[index]; if (character === '"' && line[index + 1] === '"') { value += '"'; index++; } else if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { result.push(value); value = ""; } else value += character; }
  result.push(value); return result;
}

function dataUrl(buffer: ArrayBuffer, mime: string) {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}

function fromAi(input: Record<string, unknown>): NormalizedScheduleRow {
  const studentNames = Array.isArray(input.studentNames) ? input.studentNames.map(String).map((item) => item.trim()).filter(Boolean) : String(input.studentNames || "").split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean);
  return { date: String(input.date || "").trim(), startTime: String(input.startTime || "").trim(), endTime: String(input.endTime || "").trim(), studentNames, className: String(input.className || "").trim(), courseName: String(input.courseName || "政治").trim(), location: String(input.location || "").trim(), institution: String(input.institution || "").trim(), fee: Number(input.fee || 0) || 0, baseFee: Number(input.baseFee || 0) || 0, perStudentFee: Number(input.perStudentFee || 0) || 0, settlementCycle: String(input.settlementCycle || "").trim(), notes: String(input.notes || "").trim() };
}

async function spreadsheetRows(file: File, buffer: ArrayBuffer, extension: string) {
  let tables: unknown[][][] = [], compatibility = false;
  if (extension === "csv") tables = [new TextDecoder().decode(buffer).split(/\r?\n/).filter(Boolean).map(parseCsvLine)];
  else {
    try { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); tables = workbook.worksheets.map((sheet) => { const rows: unknown[][] = []; sheet.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellValueToText))); return rows; }); }
    catch { tables = [await readFirstWorksheetCompat(buffer)]; compatibility = true; }
  }
  const selected = selectScheduleTable(tables, file.name), mapping = selected.mappingDetail.mapping;
  if (!mapping.date || !mapping.startTime) throw new Error("未识别日期或上课时间列，请检查表头");
  const sources = selected.calendarRows.length ? selected.calendarRows : selected.table.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((cells) => ({ raw: Object.fromEntries(selected.headers.map((header, index) => [header, cells[index] ?? ""])), sourceCell: "" }));
  const rows: PreparedRow[] = sources.map((source, index) => { const value = normalizeScheduleRow(source.raw, mapping, file.name); return { rowNumber: index + 2, sourceCell: source.sourceCell, raw: source.raw, value, confidence: 1, issues: validateNormalizedSchedule(value) }; });
  return { rows, mapping, format: selected.calendarRows.length ? "calendar_matrix" : "tabular", headers: selected.headers, unknownColumns: selected.mappingDetail.unknownColumns, compatibility, model: null };
}

async function visualRows(access: AccessContext, file: File, buffer: ArrayBuffer, jobId: string) {
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error("图片或 PDF 超过 8MB，请压缩或拆分页上传");
  const result = await callV2AiJson({ access, capability: "vision", jobId, promptVersion: "schedule-vision-v2.1", maxTokens: 12000,
    system: "逐格识别课表的全部课时。日期为 YYYY-MM-DD，时间为 HH:mm。不可猜测看不清的字段。输出 {rows:[{date,startTime,endTime,studentNames,className,courseName,location,institution,fee,baseFee,perStudentFee,settlementCycle,notes,confidence,sourceCell}],mapping,notes}。",
    payload: { fileName: file.name, mime: file.type }, images: [dataUrl(buffer, file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg"))],
    validate(value) { const item = value as Record<string, unknown>; if (!Array.isArray(item?.rows)) throw new Error("未返回课表行"); return { rows: item.rows.filter((row) => row && typeof row === "object").slice(0, 2500) as Record<string, unknown>[], mapping: item.mapping && typeof item.mapping === "object" ? item.mapping as ScheduleMapping : {} }; } });
  const rows: PreparedRow[] = result.data.rows.map((raw, index) => { const value = fromAi(raw), confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? .65))), issues = validateNormalizedSchedule(value); if (confidence < .75) issues.push("视觉识别置信度较低，请逐字段核对"); return { rowNumber: index + 1, sourceCell: String(raw.sourceCell || ""), raw, value, confidence, issues }; });
  return { rows, mapping: result.data.mapping, format: file.name.toLowerCase().endsWith(".pdf") ? "pdf_vision" : "image_vision", headers: [] as string[], unknownColumns: [] as unknown[], compatibility: false, model: result.model };
}

async function previews(access: AccessContext, rows: PreparedRow[]) {
  const previous = await loadPreviousScheduleIdentities(env.DB), cache: ScheduleIdentityCache = { classIds: new Map(), studentIds: new Map(), classStudentSets: new Map() };
  return Promise.all(rows.map(async (row) => ({ ...row, preview: await inspectScheduleImportRow(env.DB, row.value, row.issues, previous, { ownerId: access.id, cache }) })));
}

export async function createScheduleImportV2(access: AccessContext, form: FormData, operationId: string) {
  const file = form.get("file"); if (!(file instanceof File)) throw new Error("请选择课表文件");
  const extension = file.name.toLowerCase().split(".").pop() || ""; if (!extensions.has(extension)) throw new Error("支持 XLSX、CSV、PNG、JPG、WEBP 和 PDF");
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("文件须非空且不超过 20MB");
  const buffer = await file.arrayBuffer(), fingerprint = await digest(buffer), duplicate = await env.DB.prepare("SELECT id,state FROM v2_schedule_imports WHERE user_id=? AND fingerprint=?").bind(access.id, fingerprint).first();
  if (duplicate && form.get("allowDuplicate") !== "1") return { duplicate, conflict: true };
  const importId = crypto.randomUUID(), created = await createJob(access, { type: "schedule-import", operationId, entityType: "schedule_import", entityId: importId, state: "queued", stage: "uploaded", payload: { fileName: file.name, mimeType: file.type || "application/octet-stream", extension, size: file.size } });
  if (created.repeated) return { repeated: true, job: created.job };
  const key = `v2/schedule-imports/${new Date().toISOString().slice(0, 10)}/${importId}.${extension}`;
  await env.FILES.put(key, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { ownerId: String(access.id), originalName: file.name } });
  await env.DB.prepare("INSERT INTO v2_schedule_imports(id,user_id,job_id,source_name,source_type,storage_key,fingerprint,state,operation_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(importId, access.id, created.job.id, file.name, file.type || extension, key, fingerprint, "queued", operationId).run();
  return { id: importId, job: created.job, report: { total: 0, valid: 0, warning: 0, blocked: 0 }, mapping: {}, rows: [] };
}

export async function processScheduleImportJobV2(access: AccessContext, jobId: string) {
  const item = await env.DB.prepare("SELECT id,source_name AS sourceName,source_type AS sourceType,storage_key AS storageKey,state FROM v2_schedule_imports WHERE job_id=? AND user_id=?").bind(jobId, access.id).first<{ id: string; sourceName: string; sourceType: string; storageKey: string; state: string }>();
  if (!item) throw new Error("课表导入任务或原始文件记录不存在");
  if (["waiting_review", "completed", "partial"].includes(item.state)) return getScheduleImportV2(access, item.id);
  const object = await env.FILES.get(item.storageKey); if (!object) throw new Error("课表原始文件不存在，请重新上传");
  const buffer = await object.arrayBuffer(), extension = item.sourceName.toLowerCase().split(".").pop() || "", file = new File([buffer], item.sourceName, { type: item.sourceType || object.httpMetadata?.contentType || "application/octet-stream" });
  await env.DB.prepare("UPDATE v2_schedule_imports SET state='running',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id).run();
  try {
    await updateJob(access, jobId, { state: "running", stage: "recognizing", progress: 20, message: "正在识别课表结构" });
    const parsed = extension === "xlsx" || extension === "csv" ? await spreadsheetRows(file, buffer, extension) : await visualRows(access, file, buffer, jobId);
    if (!parsed.rows.length) throw new Error("没有识别到可导入的课时行");
    const current = await getJob(access, jobId); if (current?.cancelRequested) { await env.DB.prepare("UPDATE v2_schedule_imports SET state='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id).run(); await updateJob(access, jobId, { state: "cancelled", stage: "cancelled", progress: current.progress, message: "任务已按请求取消" }); return { cancelled: true }; }
    const rows = await previews(access, parsed.rows), statements = rows.map((row) => { const issues = [...new Set([...row.issues, ...row.preview.issues])], state: ImportRowState = row.preview.action === "blocked" || row.issues.some((issue) => !issue.includes("置信度")) ? "blocked" : row.confidence < .85 || issues.length ? "warning" : "valid"; return env.DB.prepare("INSERT INTO v2_schedule_rows(import_id,row_number,source_cell,raw_json,normalized_json,state,confidence,issues_json,action,lesson_id) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(item.id, row.rowNumber, row.sourceCell || null, JSON.stringify(row.raw), JSON.stringify(row.value), state, row.confidence, JSON.stringify(issues), row.preview.action, row.preview.existingLessonId); });
    await env.DB.prepare("DELETE FROM v2_schedule_rows WHERE import_id=? AND state IN ('valid','warning','blocked','processing','failed')").bind(item.id).run();
    for (let index = 0; index < statements.length; index += 50) await env.DB.batch(statements.slice(index, index + 50));
    const report = { total: rows.length, valid: rows.filter((row) => !row.issues.length && row.confidence >= .85 && row.preview.action !== "blocked").length, warning: rows.filter((row) => row.confidence < .85).length, blocked: rows.filter((row) => row.issues.length || row.preview.action === "blocked").length, create: rows.filter((row) => row.preview.action === "create").length, update: rows.filter((row) => row.preview.action === "update").length, skip: rows.filter((row) => row.preview.action === "skip").length, headers: parsed.headers, unknownColumns: parsed.unknownColumns, compatibility: parsed.compatibility, model: parsed.model };
    await env.DB.prepare("UPDATE v2_schedule_imports SET format=?,mapping_json=?,report_json=?,state='waiting_review',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parsed.format, JSON.stringify(parsed.mapping), JSON.stringify(report), item.id).run();
    const job = await updateJob(access, jobId, { state: "waiting_review", stage: "review", progress: 65, processed: rows.length, total: rows.length, result: { importId: item.id, report }, message: "识别完成，等待逐行确认" });
    return { id: item.id, job, report, mapping: parsed.mapping, rows: rows.slice(0, 100) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "课表识别失败"; await env.DB.prepare("UPDATE v2_schedule_imports SET state='failed',report_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify({ error: message }), item.id).run(); throw error;
  }
}

export async function listScheduleImportsV2(access: AccessContext, limit = 30) {
  const rows = await env.DB.prepare("SELECT id,job_id AS jobId,source_name AS sourceName,source_type AS sourceType,format,report_json AS reportJson,state,confirmed_at AS confirmedAt,undo_until AS undoUntil,created_at AS createdAt,updated_at AS updatedAt FROM v2_schedule_imports WHERE user_id=? ORDER BY updated_at DESC LIMIT ?").bind(access.id, Math.min(100, Math.max(1, limit))).all<Record<string, unknown>>();
  return rows.results.map((row) => ({ ...row, report: parseJsonObject(row.reportJson) }));
}

export async function getScheduleImportV2(access: AccessContext, id: string) {
  const item = await env.DB.prepare("SELECT id,job_id AS jobId,source_name AS sourceName,source_type AS sourceType,format,mapping_json AS mappingJson,report_json AS reportJson,state,confirmed_at AS confirmedAt,undo_until AS undoUntil,created_at AS createdAt,updated_at AS updatedAt FROM v2_schedule_imports WHERE id=? AND user_id=?").bind(id, access.id).first<Record<string, unknown>>(); if (!item) return null;
  const rows = await env.DB.prepare("SELECT id,row_number AS rowNumber,source_cell AS sourceCell,raw_json AS rawJson,normalized_json AS normalizedJson,previous_json AS previousJson,state,confidence,issues_json AS issuesJson,action,lesson_id AS lessonId,updated_at AS updatedAt FROM v2_schedule_rows WHERE import_id=? ORDER BY row_number,id").bind(id).all<StoredRow>();
  return { ...item, mapping: parseJsonObject(item.mappingJson), report: parseJsonObject(item.reportJson), job: await getJob(access, String(item.jobId)), rows: rows.results.map((row) => ({ ...row, raw: parseJsonObject(row.rawJson), normalized: parseJsonObject(row.normalizedJson), previous: parseJsonObject(row.previousJson), issues: parseJsonArray(row.issuesJson) })) };
}

export async function updateScheduleRowV2(access: AccessContext, importId: string, rowId: number, input: unknown, operationId: string) {
  const owner = await env.DB.prepare("SELECT state FROM v2_schedule_imports WHERE id=? AND user_id=?").bind(importId, access.id).first<{ state: string }>(); if (!owner) return null; if (!["waiting_review", "partial", "failed"].includes(owner.state)) throw new Error("当前状态不允许编辑");
  const repeated = await env.DB.prepare("SELECT 1 FROM v2_idempotency_operations WHERE user_id=? AND action='schedule-row-update' AND operation_id=? AND state='completed'").bind(access.id, operationId).first(); if (repeated) return getScheduleImportV2(access, importId);
  await env.DB.prepare("INSERT OR IGNORE INTO v2_idempotency_operations(user_id,action,operation_id,state) VALUES(?,?,?,'running')").bind(access.id, "schedule-row-update", operationId).run();
  const current = await env.DB.prepare("SELECT normalized_json AS normalizedJson FROM v2_schedule_rows WHERE id=? AND import_id=?").bind(rowId, importId).first<{ normalizedJson: string }>(); if (!current) return null;
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (body.state === "skipped") { await env.DB.batch([env.DB.prepare("UPDATE v2_schedule_rows SET state='skipped',action='skip',issues_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(rowId), env.DB.prepare("UPDATE v2_idempotency_operations SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND action='schedule-row-update' AND operation_id=?").bind(JSON.stringify({ importId, rowId, state: "skipped" }), access.id, operationId)]); return getScheduleImportV2(access, importId); }
  const value = fromAi({ ...parseJsonObject(current.normalizedJson), ...(body.normalized && typeof body.normalized === "object" ? body.normalized as Record<string, unknown> : {}) }), validation = validateNormalizedSchedule(value), previous = await loadPreviousScheduleIdentities(env.DB), preview = await inspectScheduleImportRow(env.DB, value, validation, previous, { ownerId: access.id, cache: { classIds: new Map(), studentIds: new Map(), classStudentSets: new Map() } }), issues = [...new Set([...validation, ...preview.issues])], confidence = Math.max(0, Math.min(1, Number(body.confidence ?? 1))), state: ImportRowState = preview.action === "blocked" || validation.length ? "blocked" : confidence < .85 || issues.length ? "warning" : "valid";
  await env.DB.batch([env.DB.prepare("UPDATE v2_schedule_rows SET normalized_json=?,state=?,confidence=?,issues_json=?,action=?,lesson_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND import_id=?").bind(JSON.stringify(value), state, confidence, JSON.stringify(issues), preview.action, preview.existingLessonId, rowId, importId), env.DB.prepare("UPDATE v2_idempotency_operations SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND action='schedule-row-update' AND operation_id=?").bind(JSON.stringify({ importId, rowId, state }), access.id, operationId)]); return getScheduleImportV2(access, importId);
}

const gradeFor = (name: string) => `${name.match(/([一二三四五六七八九123456789])年级/)?.[1] || "未设置"}${name.includes("年级") ? "年级" : ""}`;
async function classAndStudents(access: AccessContext, value: NormalizedScheduleRow) {
  const name = value.className || `${value.studentNames.join("、")}课程` || "待整理班级"; let item = await env.DB.prepare("SELECT id FROM classes WHERE name=? AND (owner_id=? OR owner_id IS NULL) AND status='active' LIMIT 1").bind(name, access.id).first<{ id: number }>();
  if (!item) item = await env.DB.prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,'active') RETURNING id").bind(access.id, name, "未设置", gradeFor(name), value.courseName).first<{ id: number }>(); if (!item) throw new Error(`无法创建班级“${name}”`);
  const studentIds: number[] = [];
  for (const studentName of value.studentNames) { const matches = await env.DB.prepare("SELECT id FROM students WHERE name=? AND status='active' LIMIT 2").bind(studentName).all<{ id: number }>(); if (matches.results.length > 1) throw new Error(`学生“${studentName}”存在同名档案`); let studentId = Number(matches.results[0]?.id || 0); if (!studentId) studentId = Number((await env.DB.prepare("INSERT INTO students(name,status) VALUES(?,'active') RETURNING id").bind(studentName).first<{ id: number }>())?.id || 0); if (!studentId) throw new Error(`无法创建学生“${studentName}”`); studentIds.push(studentId); await env.DB.prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,'active')").bind(item.id, studentId).run(); }
  return { classId: Number(item.id), studentIds };
}

async function timeConflict(value: NormalizedScheduleRow, excludeLessonId?: number | null) {
  const row = await env.DB.prepare("SELECT id,course_name AS courseName FROM lessons WHERE date=? AND status!='cancelled' AND start_time<? AND end_time>? AND (? IS NULL OR id!=?) ORDER BY start_time LIMIT 1").bind(value.date, value.endTime, value.startTime, excludeLessonId || null, excludeLessonId || null).first<{ id: number; courseName: string }>();
  return row || null;
}

export async function confirmScheduleImportV2(access: AccessContext, id: string, operationId: string) {
  const item = await env.DB.prepare("SELECT job_id AS jobId FROM v2_schedule_imports WHERE id=? AND user_id=?").bind(id, access.id).first<{ jobId: string }>(); if (!item) return null;
  const repeated = await env.DB.prepare("SELECT result_json AS resultJson FROM v2_idempotency_operations WHERE user_id=? AND action='schedule-confirm' AND operation_id=?").bind(access.id, operationId).first<{ resultJson: string }>(); if (repeated) return parseJsonObject(repeated.resultJson);
  const blocked = await env.DB.prepare("SELECT count(*) AS total FROM v2_schedule_rows WHERE import_id=? AND state='blocked'").bind(id).first<{ total: number }>(); if (Number(blocked?.total || 0)) throw new Error("仍有阻塞行，请修正或忽略后再确认");
  await env.DB.prepare("INSERT INTO v2_idempotency_operations(user_id,action,operation_id,state) VALUES(?,?,?,'running')").bind(access.id, "schedule-confirm", operationId).run(); await updateJob(access, item.jobId, { state: "running", stage: "writing", progress: 70, message: "正在写入已确认课时" });
  const rows = await env.DB.prepare("SELECT id,normalized_json AS normalizedJson,state,action,lesson_id AS lessonId FROM v2_schedule_rows WHERE import_id=? AND state IN ('valid','warning','failed') ORDER BY row_number,id").bind(id).all<StoredRow>(); let completed = 0, failed = 0;
  for (const row of rows.results) { try { await env.DB.prepare("UPDATE v2_schedule_rows SET state='processing',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run(); const value = fromAi(parseJsonObject(row.normalizedJson)), issues = validateNormalizedSchedule(value); if (issues.length) throw new Error(issues.join("；")); if (row.action === "skip") { await env.DB.prepare("UPDATE v2_schedule_rows SET state='skipped' WHERE id=?").bind(row.id).run(); completed++; continue; } const conflict = await timeConflict(value, row.action === "update" ? row.lessonId : null); if (conflict) { const exact = await env.DB.prepare("SELECT id FROM lessons WHERE id=? AND date=? AND start_time=? AND end_time=? AND course_name=? AND status='draft'").bind(conflict.id, value.date, value.startTime, value.endTime, value.courseName).first<{ id: number }>(); if (row.action === "create" && exact) { await env.DB.prepare("UPDATE v2_schedule_rows SET state='created',lesson_id=?,issues_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(exact.id, row.id).run(); completed++; continue; } throw new Error(`该时段与“${conflict.courseName || "其他课程"}”冲突`); } const { classId, studentIds } = await classAndStudents(access, value);
      if (row.action === "update" && row.lessonId) { const before = await env.DB.prepare("SELECT * FROM lessons WHERE id=? AND status NOT IN ('completed','cancelled')").bind(row.lessonId).first<Record<string, unknown>>(); if (!before) throw new Error("原课时已锁定或不存在"); await env.DB.prepare("UPDATE lessons SET class_id=?,date=?,start_time=?,end_time=?,location=?,course_name=?,fee=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(classId, value.date, value.startTime, value.endTime, value.location || null, value.courseName, value.fee || null, row.lessonId).run(); await env.DB.prepare("UPDATE v2_schedule_rows SET state='updated',previous_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(before), row.id).run(); }
      else { const lesson = await env.DB.prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,fee,fee_status,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft') RETURNING id").bind(classId, value.date, value.startTime, value.endTime, "offline", value.location || null, value.courseName, "未设置", gradeFor(value.className), value.fee || null, value.fee ? "review" : "untracked").first<{ id: number }>(); if (!lesson) throw new Error("无法创建课时"); for (const studentId of studentIds) await env.DB.prepare("INSERT OR IGNORE INTO attendance(lesson_id,student_id,status) VALUES(?,?,'pending')").bind(lesson.id, studentId).run(); await env.DB.prepare("UPDATE v2_schedule_rows SET state='created',lesson_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lesson.id, row.id).run(); }
      completed++; } catch (error) { failed++; await env.DB.prepare("UPDATE v2_schedule_rows SET state='failed',issues_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify([error instanceof Error ? error.message : "写入失败"]), row.id).run(); }
    await updateJob(access, item.jobId, { state: "running", stage: "writing", progress: 70 + Math.round((completed + failed) / Math.max(1, rows.results.length) * 25), processed: completed + failed, total: rows.results.length }); }
  const state = failed ? "partial" : "completed", undoUntil = new Date(Date.now() + 86_400_000).toISOString(), result = { importId: id, completed, failed, state, undoUntil };
  await env.DB.batch([env.DB.prepare("UPDATE v2_schedule_imports SET state=?,confirmed_at=CURRENT_TIMESTAMP,undo_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(state, undoUntil, id), env.DB.prepare("UPDATE v2_idempotency_operations SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND action='schedule-confirm' AND operation_id=?").bind(JSON.stringify(result), access.id, operationId)]); await updateJob(access, item.jobId, { state, stage: state, progress: state === "completed" ? 100 : 96, processed: completed + failed, total: rows.results.length, result, message: failed ? "部分失败，可修正后续跑" : "课表导入完成" }); return result;
}

export async function undoScheduleImportV2(access: AccessContext, id: string, operationId: string) {
  const repeated = await env.DB.prepare("SELECT result_json AS resultJson FROM v2_idempotency_operations WHERE user_id=? AND action='schedule-undo' AND operation_id=? AND state='completed'").bind(access.id, operationId).first<{ resultJson: string }>(); if (repeated) return parseJsonObject(repeated.resultJson);
  const item = await env.DB.prepare("SELECT job_id AS jobId,undo_until AS undoUntil FROM v2_schedule_imports WHERE id=? AND user_id=?").bind(id, access.id).first<{ jobId: string; undoUntil: string }>(); if (!item) return null; if (!item.undoUntil || Date.parse(item.undoUntil) < Date.now()) throw new Error("安全撤销窗口已结束");
  await env.DB.prepare("INSERT OR IGNORE INTO v2_idempotency_operations(user_id,action,operation_id,state) VALUES(?,?,?,'running')").bind(access.id, "schedule-undo", operationId).run();
  const rows = await env.DB.prepare("SELECT id,state,lesson_id AS lessonId,previous_json AS previousJson FROM v2_schedule_rows WHERE import_id=? AND state IN ('created','updated') ORDER BY id DESC").bind(id).all<StoredRow>(); let undone = 0; const blocked: number[] = [];
  for (const row of rows.results) { if (!row.lessonId) continue; if (row.state === "created") { const references = await env.DB.prepare("SELECT (SELECT count(*) FROM assignments WHERE lesson_id=?) + (SELECT count(*) FROM feedback WHERE lesson_id=?) AS total").bind(row.lessonId, row.lessonId).first<{ total: number }>(), lesson = await env.DB.prepare("SELECT status FROM lessons WHERE id=?").bind(row.lessonId).first<{ status: string }>(); if (Number(references?.total || 0) || lesson?.status !== "draft") { blocked.push(row.id); continue; } await env.DB.batch([env.DB.prepare("UPDATE v2_schedule_rows SET state='valid',lesson_id=NULL WHERE id=?").bind(row.id), env.DB.prepare("DELETE FROM attendance WHERE lesson_id=?").bind(row.lessonId), env.DB.prepare("DELETE FROM student_lesson_records WHERE lesson_id=?").bind(row.lessonId), env.DB.prepare("DELETE FROM lessons WHERE id=? AND status='draft'").bind(row.lessonId)]); undone++; }
    else { const before = parseJsonObject(row.previousJson); if (!Object.keys(before).length) { blocked.push(row.id); continue; } await env.DB.prepare("UPDATE lessons SET class_id=?,date=?,start_time=?,end_time=?,mode=?,location=?,course_name=?,stage=?,grade=?,fee=?,fee_status=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('completed','cancelled')").bind(before.class_id ?? null, before.date, before.start_time ?? null, before.end_time ?? null, before.mode || "offline", before.location ?? null, before.course_name, before.stage, before.grade, before.fee ?? null, before.fee_status || "untracked", before.status || "draft", row.lessonId).run(); await env.DB.prepare("UPDATE v2_schedule_rows SET state='valid',previous_json='{}' WHERE id=?").bind(row.id).run(); undone++; } }
  const state = blocked.length ? "partial" : "waiting_review", result = { importId: id, operationId, undone, blocked, state }; await env.DB.batch([env.DB.prepare("UPDATE v2_schedule_imports SET state=?,confirmed_at=NULL,undo_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(state, id), env.DB.prepare("UPDATE v2_idempotency_operations SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND action='schedule-undo' AND operation_id=?").bind(JSON.stringify(result), access.id, operationId)]); await updateJob(access, item.jobId, { state, stage: "review", progress: blocked.length ? 50 : 65, result, message: blocked.length ? "部分课时已有业务数据，未撤销" : "已安全撤销" }); return result;
}
