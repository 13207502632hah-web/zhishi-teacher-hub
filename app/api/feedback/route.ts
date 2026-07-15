import { and, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { feedback } from "../../../db/schema";
import { audit, isDenied, requireClassAccess, requireLessonAccess, requirePermission } from "../../lib/access";
import { recordConfirmedFeedbackEvent } from "../../lib/services/mini-sync-service";
import { recordFeedbackLearningEvent } from "../../lib/ai/learning";

const values = (payload: Record<string, unknown>) => ({ lessonId: payload.lessonId ? Number(payload.lessonId) : null, studentId: payload.studentId ? Number(payload.studentId) : null, classId: payload.classId ? Number(payload.classId) : null, type: String(payload.type || "lesson"), audience: String(payload.audience || "private"), lengthMode: String(payload.lengthMode || "short"), tone: String(payload.tone || "专业简洁"), customInput: String(payload.customInput || ""), previousHomework: String(payload.previousHomework || ""), classPerformance: String(payload.classPerformance || ""), weakPoints: String(payload.weakPoints || ""), dueAt: String(payload.dueAt || ""), content: String(payload.content || ""), shortContent: String(payload.shortContent || ""), standardContent: String(payload.standardContent || ""), learningContent: String(payload.learningContent || ""), highlights: String(payload.highlights || ""), consolidate: String(payload.consolidate || ""), homeworkRequirements: String(payload.homeworkRequirements || ""), parentAdvice: String(payload.parentAdvice || ""), nextFocus: String(payload.nextFocus || ""), periodStart: String(payload.periodStart || ""), periodEnd: String(payload.periodEnd || ""), periodSummary: String(payload.periodSummary || ""), progress: String(payload.progress || ""), problems: String(payload.problems || ""), goals: String(payload.goals || ""), suggestions: String(payload.suggestions || ""), status: String(payload.status || "draft"), copiedAt: payload.copiedAt ? String(payload.copiedAt) : null, confirmedAt: payload.status === "confirmed" ? new Date().toISOString() : null, sentAt: payload.sentAt ? String(payload.sentAt) : null });
const evidenceRefs = (payload: Record<string, unknown>) => (Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : []).slice(0, 50).map((item: any) => ({ sourceType: String(item.sourceType || "manual").slice(0, 60), sourceId: item.sourceId ? Number(item.sourceId) : null, label: String(item.label || "教师提供的记录").slice(0, 160), excerpt: String(item.excerpt || "").slice(0, 500), sourceDate: String(item.sourceDate || "").slice(0, 10) }));
async function saveEvidence(feedbackId: number, refs: ReturnType<typeof evidenceRefs>) { await env.DB.prepare("DELETE FROM feedback_evidence WHERE feedback_id=?").bind(feedbackId).run(); if (refs.length) await env.DB.batch(refs.map((item) => env.DB.prepare("INSERT INTO feedback_evidence(feedback_id,source_type,source_id,label,excerpt,source_date) VALUES(?,?,?,?,?,?)").bind(feedbackId, item.sourceType, item.sourceId, item.label, item.excerpt || null, item.sourceDate || null))); }

async function validateStudentClass(studentId: number | null, classId: number | null, lessonId: number | null) {
  if (!studentId || (!classId && !lessonId)) return null;
  const lesson = lessonId ? await env.DB.prepare("SELECT class_id AS classId FROM lessons WHERE id=?").bind(lessonId).first<{ classId: number | null }>() : null, scopedClassId = lesson?.classId ?? classId;
  if (!scopedClassId) return null;
  const enrolled = await env.DB.prepare("SELECT 1 AS enrolled FROM enrollments WHERE student_id=? AND class_id=? AND status='active'").bind(studentId, scopedClassId).first();
  return enrolled ? null : Response.json({ error: "所选学生不属于关联班级，无法建立反馈" }, { status: 400 });
}

export async function GET(request: Request) {
  const access = await requirePermission("feedback:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, type = params.get("type") || "", status = params.get("status") || "", lessonId = Number(params.get("lessonId") || 0), studentId = Number(params.get("studentId") || 0), classId = Number(params.get("classId") || 0), conditions = [];
  if (type) conditions.push(eq(feedback.type, type)); if (status) conditions.push(eq(feedback.status, status)); if (lessonId) conditions.push(eq(feedback.lessonId, lessonId)); if (studentId) conditions.push(eq(feedback.studentId, studentId)); if (classId) conditions.push(eq(feedback.classId, classId));
  let rows = await getDb().select().from(feedback).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(feedback.updatedAt));
  if (access.role === "assistant") { const allowed = await env.DB.prepare("SELECT f.id FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id JOIN staff_class_access sca ON sca.class_id=COALESCE(f.class_id,l.class_id) WHERE sca.user_id=?").bind(access.id).all<{ id: number }>(), ids = new Set(allowed.results.map((row) => Number(row.id))); rows = rows.filter((row) => ids.has(row.id)); }
  const withEvidence = await Promise.all(rows.map(async (row) => ({ ...row, evidence: (await env.DB.prepare("SELECT source_type AS sourceType,source_id AS sourceId,label,excerpt,source_date AS sourceDate FROM feedback_evidence WHERE feedback_id=? ORDER BY source_date DESC,id").bind(row.id).all()).results })));
  return Response.json({ feedback: withEvidence });
}

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, data = values(payload), refs = evidenceRefs(payload);
  if (!data.content.trim()) return Response.json({ error: "反馈内容不能为空" }, { status: 400 });
  if (data.type === "stage" && data.status === "confirmed" && !refs.length) return Response.json({ error: "阶段反馈确认前必须先汇总并保留至少一条真实证据来源" }, { status: 422 });
  if (access.role === "assistant") { if (data.lessonId) { const denied = await requireLessonAccess(access, data.lessonId); if (denied) return denied; } else if (data.classId) { const denied = await requireClassAccess(access, data.classId); if (denied) return denied; } else return Response.json({ error: "助教创建反馈必须关联已授权班级或课时" }, { status: 400 }); }
  const membershipError = await validateStudentClass(data.studentId, data.classId, data.lessonId); if (membershipError) return membershipError;
  const [row] = await getDb().insert(feedback).values(data).returning();
  if (!refs.length && data.lessonId) { const lesson = await env.DB.prepare("SELECT date,COALESCE(NULLIF(topic,''),course_name) AS title,actual_content AS actualContent FROM lessons WHERE id=?").bind(data.lessonId).first<Record<string, any>>(); if (lesson) refs.push({ sourceType: "lesson", sourceId: data.lessonId, label: `${lesson.date} ${lesson.title}`, excerpt: String(lesson.actualContent || "").slice(0, 500), sourceDate: lesson.date }); }
  await saveEvidence(row.id, refs);
  await audit(access, "create", "feedback", row.id, { status: row.status, type: row.type });
  await recordFeedbackLearningEvent(access, row as unknown as Record<string, any>);
  await recordConfirmedFeedbackEvent(row as unknown as Record<string, unknown>);
  return Response.json({ feedback: row }, { status: 201 });
}
