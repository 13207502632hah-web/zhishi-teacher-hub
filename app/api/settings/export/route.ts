import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

// 会话令牌哈希、微信 openid、邀请码哈希和 R2 storage key 不进入下载备份。
const tables = ["classes", "students", "enrollments", "staff_class_access", "courses", "lessons", "attendance", "student_lesson_records", "assignments", "assignment_targets", "assignment_settings", "assignment_submissions", "submission_versions", "submission_reviews", "question_sets", "questions", "wrong_questions", "papers", "paper_files", "paper_questions", "lesson_questions", "assessments", "assessment_results", "assessment_question_results", "student_mastery_adjustments", "knowledge_evidence", "feedback", "feedback_evidence", "feedback_templates", "reflections", "resources", "ai_settings", "ai_runs", "ai_feedback_drafts", "ai_feedback_learning_events", "ai_question_review_tasks", "ai_question_reviews", "demo_records", "audit_logs"];

export async function GET() {
  const access = await requirePermission("settings:export"); if (isDenied(access)) return access;
  const data: Record<string, unknown[]> = {};
  for (const table of tables) data[table] = (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
  await audit(access, "export", "workspace", null, { tables: tables.length });
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: access.email, data }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="zhishi-backup-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
