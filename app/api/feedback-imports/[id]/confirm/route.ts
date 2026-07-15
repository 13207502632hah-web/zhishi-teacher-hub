import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json().catch(() => ({})) as Record<string, unknown>, task = await env.DB.prepare("SELECT * FROM feedback_imports WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!task) return Response.json({ error: "反馈导入任务不存在" }, { status: 404 });
  if (task.status === "confirmed") return Response.json({ ok: true, repeated: true, lessonId: task.confirmed_lesson_id });
  const parsed = JSON.parse(String(task.parsed_payload || "{}")) as Record<string, unknown>, studentId = Number(parsed.studentId || 0), existingLessonId = Number(body.lessonId || task.matched_lesson_id || 0), mode = String(body.mode || (existingLessonId ? "update" : "create"));
  if (!parsed.date || !parsed.startTime || !parsed.endTime || !studentId) return Response.json({ error: "学生、日期和完整时段必须由教师确认后才能建立课时" }, { status: 409 });
  let lessonId = existingLessonId;
  if (mode === "update" && lessonId) {
    const lesson = await env.DB.prepare("SELECT status FROM lessons WHERE id=?").bind(lessonId).first<{ status: string }>();
    if (!lesson || lesson.status === "completed") return Response.json({ error: "已完成课时不能由反馈导入覆盖，请选择新建草稿" }, { status: 409 });
    await env.DB.prepare("UPDATE lessons SET location=COALESCE(NULLIF(?,''),location),actual_content=COALESCE(NULLIF(?,''),actual_content),homework=COALESCE(NULLIF(?,''),homework),next_plan=COALESCE(NULLIF(?,''),next_plan),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(parsed.location || ""), String(parsed.actualContent || ""), String(parsed.homework || ""), String(parsed.nextPlan || ""), lessonId).run();
  } else {
    const enrollment = await env.DB.prepare("SELECT e.class_id AS classId,s.grade FROM enrollments e JOIN students s ON s.id=e.student_id WHERE e.student_id=? AND e.status='active' ORDER BY e.id DESC LIMIT 1").bind(studentId).first<Record<string, unknown>>();
    const row = await env.DB.prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,actual_content,homework,next_plan,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'draft') RETURNING id").bind(enrollment?.classId || null, parsed.date, parsed.startTime, parsed.endTime, "offline", String(parsed.location || ""), "思想政治辅导", String(enrollment?.grade || "").startsWith("高") ? "高中" : "初中", String(enrollment?.grade || "待补全"), String(parsed.actualContent || ""), String(parsed.homework || ""), String(parsed.nextPlan || "")).first<{ id: number }>(); lessonId = row?.id || 0;
  }
  if (parsed.homework && lessonId) await env.DB.prepare("INSERT INTO assignments(lesson_id,class_id,title,requirements,status) SELECT ?,class_id,?,?, 'draft' FROM lessons WHERE id=? AND NOT EXISTS(SELECT 1 FROM assignments WHERE lesson_id=? AND status='draft')").bind(lessonId, `课后作业 · ${parsed.date}`, String(parsed.homework), lessonId, lessonId).run();
  await env.DB.prepare("UPDATE feedback_imports SET status='confirmed',confirmed_lesson_id=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lessonId, id).run();
  await audit(access, "confirm", "feedback_import", id, { lessonId, mode });
  return Response.json({ ok: true, lessonId, assignmentDraft: Boolean(parsed.homework) });
}
