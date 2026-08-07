import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { normalizeScheduleRow, selectScheduleTable, validateNormalizedSchedule } from "../../lib/schedule-import";
import { inspectScheduleImportRow, loadPreviousScheduleIdentities } from "../../lib/schedule-import-preview";
import { requireTeacherAdminApi } from "../../lib/teacher-auth";
import { cellValueToText, readFirstWorksheetCompat } from "../../lib/xlsx-compat";

const sha = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function GET() {
  const teacherAdmin = await requireTeacherAdminApi(); if (teacherAdmin) return teacherAdmin;
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT * FROM schedule_imports ORDER BY id DESC LIMIT 30").all();
  return Response.json({
    imports: rows.results.map((row) => ({
      ...row,
      report: parseStoredJson(row.report, {}),
    })),
  });
}

function parseStoredJson(value: unknown, fallback: unknown) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

export async function POST(request: Request) {
  const teacherAdmin = await requireTeacherAdminApi(); if (teacherAdmin) return teacherAdmin;
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择课表文件" }, { status: 400 });
  const ext = file.name.toLowerCase().split(".").pop();
  if (!ext || !["xlsx", "csv"].includes(ext)) return Response.json({ error: ext === "xls" ? "旧版 .xls 请先在 WPS 中另存为 .xlsx" : "仅支持 .xlsx 或 .csv" }, { status: 400 });
  if (!file.size || file.size > 10 * 1024 * 1024) return Response.json({ error: "课表文件应小于 10MB 且不能为空" }, { status: 413 });
  const buffer = await file.arrayBuffer(), fingerprint = await sha(buffer), duplicate = await env.DB.prepare("SELECT id,status FROM schedule_imports WHERE fingerprint=? ORDER BY id DESC LIMIT 1").bind(fingerprint).first();
  if (duplicate && form.get("allowDuplicate") !== "1") return Response.json({ error: "这份课表已导入过，请确认是否需要重新比较", duplicate }, { status: 409 });
  let tables: unknown[][][] = [], usedCompatibilityReader = false;
  if (ext === "csv") tables = [String(new TextDecoder().decode(buffer)).split(/\r?\n/).filter(Boolean).map(parseCsvLine)];
  else {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as never);
      tables = workbook.worksheets.map((sheet) => {
        const rows: unknown[][] = [];
        sheet.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as unknown[]).slice(1).map(cellValueToText)));
        return rows;
      });
    } catch {
      try { tables = [await readFirstWorksheetCompat(buffer)]; usedCompatibilityReader = true; }
      catch { return Response.json({ error: "无法读取这份 XLSX，请确认文件未加密且包含可编辑单元格；如仍失败，请在 WPS 中另存为标准 .xlsx" }, { status: 422 }); }
    }
  }
  const selected = selectScheduleTable(tables, file.name);
  const calendarRows = selected.calendarRows, format = calendarRows.length ? "calendar_matrix" : "tabular";
  const headers = selected.headers, mappingDetail = selected.mappingDetail, mapping = mappingDetail.mapping;
  if (!mapping.date || !mapping.startTime) return Response.json({ error: "未识别到日期或上课时间列，也未识别到横向日历课表；请检查首行表头或日期、时间布局", headers, suggestedMapping: mapping, unknownColumns: mappingDetail.unknownColumns }, { status: 422 });
  const sourceRows = calendarRows.length ? calendarRows : selected.table.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((cells) => ({ raw: Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])), sourceCell: "" }));
  const normalized = sourceRows.map((source, index) => { const value = normalizeScheduleRow(source.raw, mapping, file.name); return { rowNumber: index + 2, sourceCell: source.sourceCell, raw: source.raw, value, issues: validateNormalizedSchedule(value) }; });
  const previousByIdentity = await loadPreviousScheduleIdentities(env.DB);
  const rowsWithPreview = await Promise.all(normalized.map(async (row) => ({
    ...row,
    preview: await inspectScheduleImportRow(env.DB, row.value, row.issues, previousByIdentity),
  })));
  const storageKey = `schedule-imports/${Date.now()}-${fingerprint.slice(0, 12)}.${ext}`; await env.FILES.put(storageKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  const report = {
    format,
    usedCompatibilityReader,
    total: rowsWithPreview.length,
    invalid: rowsWithPreview.filter((row) => row.issues.length).length,
    create: rowsWithPreview.filter((row) => row.preview.action === "create").length,
    update: rowsWithPreview.filter((row) => row.preview.action === "update").length,
    skip: rowsWithPreview.filter((row) => row.preview.action === "skip").length,
    blocked: rowsWithPreview.filter((row) => row.preview.action === "blocked").length,
    studentsToCreate: [...new Set(rowsWithPreview.flatMap((row) => row.preview.studentsToCreate))].length,
    classesToCreate: [...new Set(rowsWithPreview.map((row) => row.preview.classToCreate).filter(Boolean))].length,
  };
  const inserted = await env.DB.prepare("INSERT INTO schedule_imports(source_name,fingerprint,mapping,report,status,created_by) VALUES(?,?,?,?,?,?) RETURNING id").bind(file.name, fingerprint, JSON.stringify(mapping), JSON.stringify({ storageKey, ...report }), "preview", access.id).first<{ id: number }>();
  if (!inserted) return Response.json({ error: "无法创建导入任务" }, { status: 500 });
  const statements = rowsWithPreview.map((row) => env.DB.prepare("INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,issue) VALUES(?,?,?,?,?,?)").bind(inserted.id, row.rowNumber, JSON.stringify(row.raw), JSON.stringify(row.value), row.issues.length ? "blocked" : "pending", row.issues.join("；") || null));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  await audit(access, "preview", "schedule_import", inserted.id, { total: rowsWithPreview.length });
  return Response.json({ id: inserted.id, format, headers, mapping, rows: rowsWithPreview, report, unknownColumns: mappingDetail.unknownColumns }, { status: 201 });
}

function parseCsvLine(line: string) { const result: string[] = []; let value = "", quoted = false; for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"' && line[i + 1] === '"') { value += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { result.push(value); value = ""; } else value += char; } result.push(value); return result; }
