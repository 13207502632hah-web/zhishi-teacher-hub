import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";

export async function GET() {
  const access = await requirePermission("portal:read"); if (isDenied(access)) return access;
  const linkColumn = access.role === "parent" ? "guardian_user_id" : "user_id";
  const students = await env.DB.prepare(`SELECT id,name,nickname,grade,stage_goal AS stageGoal FROM students WHERE ${linkColumn}=?`).bind(access.id).all();
  const ids = students.results.map((student) => Number(student.id));
  if (!ids.length) return Response.json({ role: access.role, students: [], assignments: [], feedback: [], resources: [] });
  const placeholders = ids.map(() => "?").join(",");
  const [assignments, feedback, resources] = await Promise.all([
    env.DB.prepare(`SELECT s.id,s.student_id AS studentId,s.status,s.score,a.title,a.requirements,a.due_at AS dueAt FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.student_id IN (${placeholders}) ORDER BY a.due_at DESC`).bind(...ids).all(),
    env.DB.prepare(`SELECT f.id,f.student_id AS studentId,f.type,f.content,f.confirmed_at AS confirmedAt FROM feedback f WHERE f.status='confirmed' AND (f.student_id IN (${placeholders}) OR (f.student_id IS NULL AND f.class_id IN (SELECT class_id FROM enrollments WHERE student_id IN (${placeholders}) AND status='active'))) ORDER BY f.confirmed_at DESC`).bind(...ids,...ids).all(),
    env.DB.prepare("SELECT id,title,type,url,tags,content FROM resources WHERE visibility='public' ORDER BY updated_at DESC LIMIT 30").all(),
  ]);
  return Response.json({ role: access.role, students: students.results, assignments: assignments.results, feedback: feedback.results, resources: resources.results });
}
