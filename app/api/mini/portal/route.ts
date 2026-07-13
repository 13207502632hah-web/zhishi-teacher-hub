import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../lib/mini-auth";
import { accessibleStudentIds } from "../../../lib/services/mini-sync-service";

export async function GET(request: Request) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  if (access.role === "teacher") return Response.json({ error: "教师完整学情与财务请使用网站工作台" }, { status: 400 });
  const requested = Number(new URL(request.url).searchParams.get("studentId") || 0), allowed = await accessibleStudentIds(access);
  const studentId = requested || allowed[0] || 0;
  if (!studentId || !allowed.includes(studentId)) return Response.json({ error: "尚未绑定学生或无权查看该学生" }, { status: 403 });
  const [lessons, feedback, results, finance] = await env.DB.batch([
    env.DB.prepare("SELECT l.date,l.start_time AS startTime,l.end_time AS endTime,l.location,l.course_name AS courseName,l.topic,l.status FROM lessons l JOIN enrollments e ON e.class_id=l.class_id WHERE e.student_id=? AND e.status='active' AND l.date>=date('now','-30 day') ORDER BY l.date,l.start_time").bind(studentId),
    env.DB.prepare("SELECT f.lesson_id AS lessonId,COALESCE(f.short_content,f.content) AS content,f.confirmed_at AS confirmedAt,l.date FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='confirmed' AND (f.student_id=? OR (f.student_id IS NULL AND EXISTS(SELECT 1 FROM enrollments e WHERE e.student_id=? AND e.status='active' AND e.class_id=COALESCE(f.class_id,l.class_id)))) ORDER BY f.confirmed_at DESC LIMIT 20").bind(studentId, studentId),
    env.DB.prepare("SELECT a.title,a.date,a.total_score AS totalScore,ar.score,ar.weak_knowledge AS weakKnowledge FROM assessment_results ar JOIN assessments a ON a.id=ar.assessment_id WHERE ar.student_id=? ORDER BY a.date DESC LIMIT 12").bind(studentId),
    env.DB.prepare("SELECT l.date,l.course_name AS courseName,lb.billing_factor AS hours,lb.unit_fee AS unitPrice,lb.amount,lf.received_amount AS received,lp.balance_hours AS packageBalance FROM lesson_billing_items lb JOIN lesson_finance lf ON lf.id=lb.lesson_finance_id JOIN lessons l ON l.id=lf.lesson_id LEFT JOIN lesson_packages lp ON lp.student_id=lb.student_id AND lp.status='active' WHERE lb.student_id=? AND lf.payer_type='parent' ORDER BY l.date DESC LIMIT 30").bind(studentId),
  ]);
  return Response.json({ studentId, lessons: lessons.results, feedback: feedback.results, results: results.results, finance: finance.results });
}
