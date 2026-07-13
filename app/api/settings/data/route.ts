import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function DELETE(request: Request) {
  const access = await requirePermission("settings:delete"); if (isDenied(access)) return access;
  const body = await request.json() as { confirmation?: string };
  if (body.confirmation !== "删除全部教学数据") return Response.json({ error: "确认文字不匹配，未执行删除" }, { status: 400 });
  const tables = ["paper_files", "paper_questions", "lesson_questions", "wrong_questions", "assessment_results", "student_mastery_adjustments", "assessments", "assignment_submissions", "assignments", "attendance", "student_lesson_records", "feedback", "feedback_templates", "reflections", "enrollments", "staff_class_access", "papers", "questions", "question_sets", "lessons", "courses", "resources", "demo_records", "students", "classes"];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await audit(access, "delete_all", "workspace", null, { tables: tables.length });
  return Response.json({ ok: true });
}
