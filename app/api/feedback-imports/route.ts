import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { parseFeedbackText } from "../../lib/feedback-import";

export async function GET() {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT fi.*,fa.original_name AS sourceName FROM feedback_imports fi LEFT JOIN file_assets fa ON fa.id=fi.source_asset_id ORDER BY fi.id DESC LIMIT 50").all();
  return Response.json({ imports: rows.results });
}
export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, sourceText = String(body.sourceText || "").trim(), ocrText = String(body.ocrText || "").trim(), sourceAssetId = Number(body.sourceAssetId || 0) || null;
  const combined = [sourceText, ocrText].filter(Boolean).join("\n");
  if (!combined) return Response.json({ error: "请粘贴反馈文字，或先在浏览器中识别图片文字" }, { status: 400 });
  const students = (await env.DB.prepare("SELECT id,name FROM students WHERE status='active' ORDER BY length(name) DESC").all<{ id: number; name: string }>()).results;
  const parsed = parseFeedbackText(combined, students);
  let matchedLessonId: number | null = null;
  if (parsed.date && parsed.studentId) { const match = await env.DB.prepare("SELECT l.id FROM lessons l JOIN enrollments e ON e.class_id=l.class_id AND e.student_id=? AND e.status='active' WHERE l.date=? AND (?='' OR l.start_time=?) ORDER BY l.start_time LIMIT 1").bind(parsed.studentId, parsed.date, parsed.startTime, parsed.startTime).first<{ id: number }>(); matchedLessonId = match?.id || null; }
  const row = await env.DB.prepare("INSERT INTO feedback_imports(source_asset_id,source_text,ocr_text,parsed_payload,confidence,status,matched_lesson_id,created_by) VALUES(?,?,?,?,?,'draft',?,?) RETURNING id").bind(sourceAssetId, sourceText || null, ocrText || null, JSON.stringify(parsed), parsed.confidence, matchedLessonId, access.id).first<{ id: number }>();
  await audit(access, "create", "feedback_import", row?.id, { confidence: parsed.confidence, matchedLessonId });
  return Response.json({ id: row?.id, parsed, matchedLessonId }, { status: 201 });
}
