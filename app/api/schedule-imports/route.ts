import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { detectScheduleMapping, normalizeScheduleRow, validateNormalizedSchedule } from "../../lib/schedule-import";

const sha = async (buffer: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function GET() {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT * FROM schedule_imports ORDER BY id DESC LIMIT 30").all();
  return Response.json({ imports: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const form = await request.formData(), file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "请选择课表文件" }, { status: 400 });
  const ext = file.name.toLowerCase().split(".").pop();
  if (!ext || !["xlsx", "csv"].includes(ext)) return Response.json({ error: ext === "xls" ? "旧版 .xls 请先在 WPS 中另存为 .xlsx" : "仅支持 .xlsx 或 .csv" }, { status: 400 });
  if (!file.size || file.size > 10 * 1024 * 1024) return Response.json({ error: "课表文件应小于 10MB 且不能为空" }, { status: 413 });
  const buffer = await file.arrayBuffer(), fingerprint = await sha(buffer), duplicate = await env.DB.prepare("SELECT id,status FROM schedule_imports WHERE fingerprint=? ORDER BY id DESC LIMIT 1").bind(fingerprint).first();
  if (duplicate && form.get("allowDuplicate") !== "1") return Response.json({ error: "这份课表已导入过，请确认是否需要重新比较", duplicate }, { status: 409 });
  let table: unknown[][] = [];
  if (ext === "csv") table = String(new TextDecoder().decode(buffer)).split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  else {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); const sheet = workbook.worksheets[0];
    if (sheet) sheet.eachRow((row) => table.push((row.values as unknown[]).slice(1).map((cell: any) => cell?.text ?? cell?.result ?? cell)));
  }
  const headers = (table.shift() || []).map(String), mapping = detectScheduleMapping(headers);
  if (!mapping.date || !mapping.startTime) return Response.json({ error: "未识别到日期或上课时间列，请在预览中补充映射", headers, suggestedMapping: mapping }, { status: 422 });
  const normalized = table.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((cells, index) => {
    const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])), value = normalizeScheduleRow(raw, mapping);
    return { rowNumber: index + 2, raw, value, issues: validateNormalizedSchedule(value) };
  });
  const storageKey = `schedule-imports/${Date.now()}-${fingerprint.slice(0, 12)}.${ext}`; await env.FILES.put(storageKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  const inserted = await env.DB.prepare("INSERT INTO schedule_imports(source_name,fingerprint,mapping,report,status,created_by) VALUES(?,?,?,?,?,?) RETURNING id").bind(file.name, fingerprint, JSON.stringify(mapping), JSON.stringify({ storageKey, total: normalized.length, invalid: normalized.filter((row) => row.issues.length).length }), "preview", access.id).first<{ id: number }>();
  if (!inserted) return Response.json({ error: "无法创建导入任务" }, { status: 500 });
  const statements = normalized.map((row) => env.DB.prepare("INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,issue) VALUES(?,?,?,?,?,?)").bind(inserted.id, row.rowNumber, JSON.stringify(row.raw), JSON.stringify(row.value), row.issues.length ? "blocked" : "pending", row.issues.join("；") || null));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  await audit(access, "preview", "schedule_import", inserted.id, { total: normalized.length });
  return Response.json({ id: inserted.id, headers, mapping, rows: normalized, report: { total: normalized.length, invalid: normalized.filter((row) => row.issues.length).length } }, { status: 201 });
}

function parseCsvLine(line: string) { const result: string[] = []; let value = "", quoted = false; for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"' && line[i + 1] === '"') { value += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { result.push(value); value = ""; } else value += char; } result.push(value); return result; }

