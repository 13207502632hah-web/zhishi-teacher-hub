import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";
import { questionReviewSummary } from "../../lib/question-review";

const chinaDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

export async function GET() {
  const access = await requirePermission("dashboard:read"); if (isDenied(access)) return access;
  const db = env.DB, now = new Date(), today = chinaDate(now), horizonDate = chinaDate(new Date(now.getTime() + 7 * 86_400_000)), monday = new Date(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); const week = chinaDate(monday), assistant = access.role === "assistant";
  const scoped = (sql: string, bind: unknown[] = []) => db.prepare(sql).bind(...bind, ...(assistant ? [access.id] : []));
  const lessonScope = assistant ? " AND class_id IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : "", joinedScope = assistant ? " AND l.class_id IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : "";
  const [results, reviewSummary] = await Promise.all([db.batch([
    scoped(`SELECT COUNT(*) AS count FROM lessons WHERE date >= ?${lessonScope}`, [week]),
    scoped(`SELECT COUNT(*) AS count FROM lessons WHERE status IN ('draft','scheduled','makeup','rescheduled')${lessonScope}`),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='confirmed' AND f.confirmed_at >= ?${assistant ? " AND COALESCE(f.class_id,l.class_id) IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : ""}`, [week]),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='draft'${assistant ? " AND COALESCE(f.class_id,l.class_id) IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : ""}`),
    scoped(`SELECT COUNT(*) AS total, SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${joinedScope}`),
    scoped(`SELECT COUNT(*) AS total, SUM(CASE WHEN s.status = 'completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${joinedScope}`),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.mode,l.location,l.online_link AS onlineLink,l.status,c.name AS className,CASE WHEN TRIM(COALESCE(l.teaching_goals,''))<>'' OR TRIM(COALESCE(l.materials,''))<>'' THEN 1 ELSE 0 END AS prepReady,CASE WHEN TRIM(COALESCE(l.actual_content,''))<>'' THEN 1 ELSE 0 END AS hasActualContent,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=l.class_id AND e.status='active') AS memberCount,(SELECT COUNT(*) FROM attendance a WHERE a.lesson_id=l.id) AS attendanceCount,(SELECT COUNT(*) FROM assignments a WHERE a.lesson_id=l.id) AS assignmentCount,(SELECT COUNT(*) FROM feedback f WHERE f.lesson_id=l.id) AS feedbackCount,(SELECT status FROM lesson_finance lf WHERE lf.lesson_id=l.id) AS financeStatus FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=?${joinedScope} ORDER BY l.start_time`, [today]),
    scoped(`SELECT COUNT(*) AS count FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE s.status != 'completed'${joinedScope}`),
    scoped(`SELECT COUNT(*) AS count FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.risk_confirmed = 1${joinedScope}`),
    scoped(`SELECT s.id,s.name,s.grade,r.risk_tags AS riskTags FROM student_lesson_records r JOIN students s ON s.id=r.student_id JOIN lessons l ON l.id=r.lesson_id WHERE r.risk_confirmed=1${joinedScope} ORDER BY r.updated_at DESC LIMIT 5`),
    scoped(`SELECT r.id,r.date,substr(COALESCE(NULLIF(r.effective_practices,''),r.next_action),1,90) AS summary,l.topic FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id WHERE 1=1${joinedScope} ORDER BY r.updated_at DESC LIMIT 3`),
    db.prepare("SELECT id,substr(stem,1,90) AS stem,status,updated_at AS updatedAt FROM questions ORDER BY updated_at DESC LIMIT 4"),
    assistant ? scoped("SELECT COUNT(DISTINCT class_id) AS count FROM staff_class_access WHERE user_id=?") : db.prepare("SELECT COUNT(*) AS count FROM classes WHERE status='active'"),
    assistant ? scoped("SELECT COUNT(DISTINCT e.student_id) AS count FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE sca.user_id=? AND e.status='active'") : db.prepare("SELECT COUNT(*) AS count FROM students WHERE status='active'"),
    db.prepare("SELECT COUNT(*) AS count FROM assessments WHERE status='draft'"),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.status,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date>? AND l.date<=? AND l.status!='cancelled'${joinedScope} ORDER BY l.date,l.start_time LIMIT 12`, [today, horizonDate]),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.course_name AS courseName,l.topic,l.status,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date<? AND l.status IN ('draft','scheduled','makeup','rescheduled')${joinedScope} ORDER BY l.date DESC,l.start_time DESC LIMIT 8`, [today]),
    scoped(`SELECT COUNT(*) AS count FROM lessons l WHERE l.status='completed' AND (TRIM(COALESCE(l.next_plan,''))='' OR NOT EXISTS(SELECT 1 FROM assignments a WHERE a.lesson_id=l.id) OR NOT EXISTS(SELECT 1 FROM feedback f WHERE f.lesson_id=l.id))${joinedScope}`),
    scoped(`SELECT COUNT(*) AS count FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id WHERE lf.status='review'${joinedScope}`),
  ]), questionReviewSummary(db)]);
  const number = (index: number, key = "count") => Number((results[index].results[0] as Record<string, unknown> | undefined)?.[key] || 0), rate = (index: number) => { const total = number(index, "total"); return total ? Math.round(number(index, "done") / total * 100) : null; };
  return Response.json({ weekLessons: number(0), draftLessons: number(1), confirmedFeedback: number(2), pendingFeedback: number(3), attendanceRate: rate(4), homeworkRate: rate(5), todayLessons: results[6].results, pendingHomework: number(7), riskCount: number(8), riskStudents: results[9].results, recentReflections: access.role === "teacher" ? results[10].results : [], recentQuestions: results[11].results, pendingReview: reviewSummary.total, reviewIssues: reviewSummary, activeClasses: number(12), activeStudents: number(13), pendingAssessments: number(14), upcomingLessons: results[15].results, overdueLessons: results[16].results, postLessonTodos: number(17), pendingFinance: number(18), horizonDate });
}
