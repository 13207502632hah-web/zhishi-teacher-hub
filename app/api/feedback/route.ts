import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { feedback } from "../../../db/schema";
import { audit, isDenied, requireClassAccess, requireLessonAccess, requirePermission } from "../../lib/access";

const values = (payload: Record<string, unknown>) => ({ lessonId: payload.lessonId ? Number(payload.lessonId) : null, studentId: payload.studentId ? Number(payload.studentId) : null, classId: payload.classId ? Number(payload.classId) : null, type: String(payload.type || "lesson"), tone: String(payload.tone || "专业简洁"), content: String(payload.content || ""), learningContent: String(payload.learningContent || ""), highlights: String(payload.highlights || ""), consolidate: String(payload.consolidate || ""), homeworkRequirements: String(payload.homeworkRequirements || ""), parentAdvice: String(payload.parentAdvice || ""), nextFocus: String(payload.nextFocus || ""), periodStart: String(payload.periodStart || ""), periodEnd: String(payload.periodEnd || ""), periodSummary: String(payload.periodSummary || ""), progress: String(payload.progress || ""), problems: String(payload.problems || ""), goals: String(payload.goals || ""), suggestions: String(payload.suggestions || ""), status: String(payload.status || "draft"), confirmedAt: payload.status === "confirmed" ? new Date().toISOString() : null });

export async function GET(request: Request) {
  const access = await requirePermission("feedback:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, type = params.get("type") || "", status = params.get("status") || "", conditions = [];
  if (type) conditions.push(eq(feedback.type, type)); if (status) conditions.push(eq(feedback.status, status));
  let rows = await getDb().select().from(feedback).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(feedback.updatedAt));
  if (access.role === "assistant") { const allowed = await env.DB.prepare("SELECT f.id FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id JOIN staff_class_access sca ON sca.class_id=COALESCE(f.class_id,l.class_id) WHERE sca.user_id=?").bind(access.id).all<{ id: number }>(), ids = new Set(allowed.results.map((row) => Number(row.id))); rows = rows.filter((row) => ids.has(row.id)); }
  return Response.json({ feedback: rows });
}

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, data = values(payload);
  if (!data.content.trim()) return Response.json({ error: "反馈内容不能为空" }, { status: 400 });
  if (access.role === "assistant") { if (data.lessonId) { const denied = await requireLessonAccess(access, data.lessonId); if (denied) return denied; } else if (data.classId) { const denied = await requireClassAccess(access, data.classId); if (denied) return denied; } else return Response.json({ error: "助教创建反馈必须关联已授权班级或课时" }, { status: 400 }); }
  const [row] = await getDb().insert(feedback).values(data).returning();
  await audit(access, "create", "feedback", row.id, { status: row.status, type: row.type });
  return Response.json({ feedback: row }, { status: 201 });
}
