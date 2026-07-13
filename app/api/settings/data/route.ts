import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function DELETE(request: Request) {
  const access = await requirePermission("settings:delete"); if (isDenied(access)) return access;
  const body = await request.json() as { confirmation?: string };
  if (body.confirmation !== "删除全部教学数据") return Response.json({ error: "确认文字不匹配，未执行删除" }, { status: 400 });
  const tables = [
    "reminder_tasks", "sync_events", "idempotency_operations",
    "submission_reviews", "review_annotations", "excellent_submissions", "submission_assets", "submission_versions",
    "assignment_assets", "assignment_targets", "assignment_settings", "assignment_submissions", "assignments",
    "file_leases", "recognition_items", "recognition_jobs", "file_assets",
    "mini_bindings", "parent_student_links", "mini_sessions", "mini_invites", "wechat_accounts",
    "knowledge_evidence", "assessment_question_results", "paper_files", "paper_questions", "lesson_questions", "wrong_questions",
    "assessment_results", "student_mastery_adjustments", "assessments", "attendance", "student_lesson_records",
    "settlement_items", "settlements", "package_ledger", "lesson_billing_items", "lesson_finance", "lesson_packages", "pricing_rules", "institutions",
    "schedule_import_rows", "schedule_imports", "calendar_subscriptions",
    "feedback", "feedback_templates", "reflections", "enrollments", "staff_class_access", "papers", "questions", "question_sets", "lessons", "courses", "resources", "demo_records", "students", "classes",
  ];
  await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  await audit(access, "delete_all", "workspace", null, { tables: tables.length });
  return Response.json({ ok: true });
}
