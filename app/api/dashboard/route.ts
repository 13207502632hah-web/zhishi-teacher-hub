import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";

export async function GET() {
  const access = await requirePermission("dashboard:read"); if (isDenied(access)) return access;
  const db = env.DB, today = new Date().toISOString().slice(0, 10), monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); const week = monday.toISOString().slice(0, 10), assistant = access.role === "assistant";
  const scoped = (sql: string, bind: unknown[] = []) => db.prepare(sql).bind(...bind, ...(assistant ? [access.id] : []));
  const lessonScope = assistant ? " AND class_id IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : "", joinedScope = assistant ? " AND l.class_id IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : "";
  const results = await db.batch([
    scoped(`SELECT COUNT(*) AS count FROM lessons WHERE date >= ?${lessonScope}`, [week]),
    scoped(`SELECT COUNT(*) AS count FROM lessons WHERE status IN ('draft','scheduled','makeup','rescheduled')${lessonScope}`),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='confirmed' AND f.confirmed_at >= ?${assistant ? " AND COALESCE(f.class_id,l.class_id) IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : ""}`, [week]),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='draft'${assistant ? " AND COALESCE(f.class_id,l.class_id) IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : ""}`),
    scoped(`SELECT COUNT(*) AS total, SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${joinedScope}`),
    scoped(`SELECT COUNT(*) AS total, SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${joinedScope}`),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.mode,l.location,l.online_link AS onlineLink,l.status,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=?${joinedScope} ORDER BY l.start_time`, [today]),
    scoped(`SELECT COUNT(*) AS count FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE s.status != 'completed'${joinedScope}`),
    scoped(`SELECT COUNT(*) AS count FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.risk_confirmed = 1${joinedScope}`),
    scoped(`SELECT s.id,s.name,s.grade,r.risk_tags AS riskTags FROM student_lesson_records r JOIN students s ON s.id=r.student_id JOIN lessons l ON l.id=r.lesson_id WHERE r.risk_confirmed=1${joinedScope} ORDER BY r.updated_at DESC LIMIT 5`),
    scoped(`SELECT r.id,r.date,substr(COALESCE(NULLIF(r.effective_practices,''),r.next_action),1,90) AS summary,l.topic FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id WHERE 1=1${joinedScope} ORDER BY r.updated_at DESC LIMIT 3`),
    db.prepare("SELECT id,substr(stem,1,90) AS stem,status,updated_at AS updatedAt FROM questions ORDER BY updated_at DESC LIMIT 4"),
    db.prepare("SELECT COUNT(*) AS count FROM questions WHERE status='review'"),
    assistant ? scoped("SELECT COUNT(DISTINCT class_id) AS count FROM staff_class_access WHERE user_id=?") : db.prepare("SELECT COUNT(*) AS count FROM classes WHERE status='active'"),
    assistant ? scoped("SELECT COUNT(DISTINCT e.student_id) AS count FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE sca.user_id=? AND e.status='active'") : db.prepare("SELECT COUNT(*) AS count FROM students WHERE status='active'"),
    db.prepare("SELECT COUNT(*) AS count FROM assessments WHERE status='draft'"),
  ]);
  const number = (index: number, key = "count") => Number((results[index].results[0] as Record<string, unknown> | undefined)?.[key] || 0), rate = (index: number) => { const total = number(index, "total"); return total ? Math.round(number(index, "done") / total * 100) : null; };
  return Response.json({ weekLessons: number(0), draftLessons: number(1), confirmedFeedback: number(2), pendingFeedback: number(3), attendanceRate: rate(4), homeworkRate: rate(5), todayLessons: results[6].results, pendingHomework: number(7), riskCount: number(8), riskStudents: results[9].results, recentReflections: access.role === "teacher" ? results[10].results : [], recentQuestions: results[11].results, pendingReview: number(12), activeClasses: number(13), activeStudents: number(14), pendingAssessments: number(15) });
}
