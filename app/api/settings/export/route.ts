import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

const tables = ["classes", "students", "enrollments", "staff_class_access", "courses", "lessons", "attendance", "student_lesson_records", "assignments", "assignment_submissions", "question_sets", "questions", "wrong_questions", "papers", "paper_files", "paper_questions", "lesson_questions", "assessments", "assessment_results", "student_mastery_adjustments", "feedback", "feedback_templates", "reflections", "resources", "demo_records", "audit_logs"];

export async function GET() {
  const access = await requirePermission("settings:export"); if (isDenied(access)) return access;
  const data: Record<string, unknown[]> = {};
  for (const table of tables) data[table] = (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
  await audit(access, "export", "workspace", null, { tables: tables.length });
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), exportedBy: access.email, data }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="zhishi-backup-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
