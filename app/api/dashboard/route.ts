import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";
import { questionReviewSummary } from "../../lib/question-review";
import { lessonDisplay } from "../../lib/lesson-display";
import { ensurePromotionRun } from "../../lib/services/grade-promotion-service";

const chinaDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const chinaTime = (value: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
const shiftDate = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

type Action = { key: string; type: string; title: string; reason: string; dueAt: string; href: string; updatedAt?: string };

export async function GET(request: Request) {
  const access = await requirePermission("dashboard:read"); if (isDenied(access)) return access;
  const requestedDays = Number(new URL(request.url).searchParams.get("days") || 7), horizonDays = [7, 14, 30].includes(requestedDays) ? requestedDays : 7;
  const db = env.DB, now = new Date(), today = chinaDate(now), currentTime = chinaTime(now), horizonDate = shiftDate(today, horizonDays), monday = shiftDate(today, -((dayOfWeek(today) + 6) % 7)), sunday = shiftDate(monday, 6), fourWeeksAgo = shiftDate(today, -27), assistant = access.role === "assistant";
  const lessonScope = assistant ? " AND EXISTS (SELECT 1 FROM staff_class_access sca WHERE sca.class_id=l.class_id AND sca.user_id=?)" : "";
  const feedbackScope = assistant ? " AND COALESCE(f.class_id,l.class_id) IN (SELECT class_id FROM staff_class_access WHERE user_id=?)" : "";
  const studentScope = assistant ? " AND EXISTS (SELECT 1 FROM enrollments se JOIN staff_class_access sca ON sca.class_id=se.class_id WHERE se.student_id=s.id AND se.status='active' AND sca.user_id=?)" : "";
  const scoped = (sql: string, bind: unknown[] = []) => db.prepare(sql).bind(...bind, ...(assistant ? [access.id] : []));
  const [results, reviewSummary] = await Promise.all([db.batch([
    scoped(`SELECT COUNT(*) AS count FROM lessons l WHERE l.date BETWEEN ? AND ? AND l.status!='cancelled'${lessonScope}`, [monday, sunday]),
    scoped(`SELECT COUNT(*) AS count FROM lessons l WHERE l.status IN ('draft','scheduled','makeup','rescheduled')${lessonScope}`),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='confirmed' AND date(f.confirmed_at) BETWEEN ? AND ?${feedbackScope}`, [monday, sunday]),
    scoped(`SELECT COUNT(*) AS count FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.status='draft'${feedbackScope}`),
    scoped(`SELECT COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${lessonScope}`),
    scoped(`SELECT COUNT(*) AS total,SUM(CASE WHEN s.status IN ('completed','corrected') THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE 1=1${lessonScope}`),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.mode,l.location,l.online_link AS onlineLink,l.status,c.name AS className,CASE WHEN TRIM(COALESCE(l.teaching_goals,''))<>'' AND TRIM(COALESCE(l.key_points,''))<>'' AND TRIM(COALESCE(l.materials,''))<>'' THEN 1 ELSE 0 END AS prepReady,CASE WHEN TRIM(COALESCE(l.actual_content,''))<>'' THEN 1 ELSE 0 END AS hasActualContent,(SELECT COUNT(*) FROM enrollments e WHERE e.class_id=l.class_id AND e.status='active') AS memberCount,(SELECT COUNT(*) FROM attendance a WHERE a.lesson_id=l.id) AS attendanceCount,(SELECT COUNT(*) FROM assignments a WHERE a.lesson_id=l.id) AS assignmentCount,(SELECT COUNT(*) FROM feedback f WHERE f.lesson_id=l.id) AS feedbackCount,(SELECT status FROM lesson_finance lf WHERE lf.lesson_id=l.id) AS financeStatus FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=?${lessonScope} ORDER BY l.start_time`, [today]),
    scoped(`SELECT COUNT(*) AS count FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE s.status NOT IN ('completed','corrected')${lessonScope}`),
    scoped(`SELECT COUNT(DISTINCT s.id) AS count FROM students s LEFT JOIN student_lesson_records r ON r.student_id=s.id LEFT JOIN lessons l ON l.id=r.lesson_id WHERE s.status='active' AND (s.risk_confirmed=1 OR (r.risk_confirmed=1 AND l.date>=?))${studentScope}`, [fourWeeksAgo]),
    scoped(`SELECT DISTINCT s.id,s.name,s.grade,COALESCE(NULLIF(r.risk_tags,''),s.risk_tags) AS riskTags,COALESCE(r.updated_at,s.updated_at) AS updatedAt FROM students s LEFT JOIN student_lesson_records r ON r.student_id=s.id AND r.risk_confirmed=1 LEFT JOIN lessons l ON l.id=r.lesson_id WHERE s.status='active' AND (s.risk_confirmed=1 OR (r.risk_confirmed=1 AND l.date>=?))${studentScope} ORDER BY updatedAt DESC LIMIT 8`, [fourWeeksAgo]),
    scoped(`SELECT r.id,r.date,substr(COALESCE(NULLIF(r.effective_practices,''),r.next_action),1,90) AS summary,l.topic FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id WHERE 1=1${lessonScope} ORDER BY r.updated_at DESC LIMIT 3`),
    db.prepare("SELECT id,substr(stem,1,90) AS stem,status,updated_at AS updatedAt FROM questions ORDER BY updated_at DESC LIMIT 4"),
    assistant ? db.prepare("SELECT COUNT(DISTINCT class_id) AS count FROM staff_class_access WHERE user_id=?").bind(access.id) : db.prepare("SELECT COUNT(*) AS count FROM classes WHERE status='active'"),
    assistant ? db.prepare("SELECT COUNT(DISTINCT e.student_id) AS count FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE sca.user_id=? AND e.status='active'").bind(access.id) : db.prepare("SELECT COUNT(*) AS count FROM students WHERE status='active'"),
    db.prepare("SELECT COUNT(*) AS count FROM assessments WHERE status='draft'"),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.status,c.name AS className,CASE WHEN TRIM(COALESCE(l.teaching_goals,''))<>'' AND TRIM(COALESCE(l.key_points,''))<>'' AND TRIM(COALESCE(l.materials,''))<>'' THEN 1 ELSE 0 END AS prepReady FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date>? AND l.date<=? AND l.status!='cancelled'${lessonScope} ORDER BY l.date,l.start_time LIMIT 30`, [today, horizonDate]),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.status,c.name AS className,l.updated_at AS updatedAt FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date<? AND l.status IN ('draft','scheduled','makeup','rescheduled')${lessonScope} ORDER BY l.date,l.start_time LIMIT 12`, [today]),
    scoped(`SELECT COUNT(*) AS count FROM lessons l WHERE l.status='completed' AND (TRIM(COALESCE(l.next_plan,''))='' OR NOT EXISTS(SELECT 1 FROM assignments a WHERE a.lesson_id=l.id) OR NOT EXISTS(SELECT 1 FROM feedback f WHERE f.lesson_id=l.id))${lessonScope}`),
    scoped(`SELECT COUNT(*) AS count FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id WHERE lf.status='review'${lessonScope}`),
    scoped(`SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.status,c.name AS className,CASE WHEN TRIM(COALESCE(l.teaching_goals,''))<>'' AND TRIM(COALESCE(l.key_points,''))<>'' AND TRIM(COALESCE(l.materials,''))<>'' THEN 1 ELSE 0 END AS prepReady FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE (l.date>? OR (l.date=? AND COALESCE(NULLIF(l.end_time,''),NULLIF(l.start_time,''),'23:59')>=?)) AND l.status NOT IN ('cancelled','completed')${lessonScope} ORDER BY l.date,l.start_time LIMIT 1`, [today, today, currentTime]),
    scoped(`SELECT a.id,a.lesson_id AS lessonId,a.title,a.due_at AS dueAt,a.updated_at AS updatedAt,COUNT(*) AS pendingCount FROM assignments a JOIN assignment_submissions s ON s.assignment_id=a.id LEFT JOIN lessons l ON l.id=a.lesson_id WHERE s.status NOT IN ('completed','corrected')${lessonScope} GROUP BY a.id ORDER BY CASE WHEN a.due_at IS NULL OR a.due_at='' THEN 1 ELSE 0 END,a.due_at,a.updated_at LIMIT 8`),
    scoped(`SELECT f.id,f.lesson_id AS lessonId,COALESCE(s.name,c.name,'课程反馈') AS subject,f.due_at AS dueAt,f.updated_at AS updatedAt FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id LEFT JOIN students s ON s.id=f.student_id LEFT JOIN classes c ON c.id=COALESCE(f.class_id,l.class_id) WHERE f.status='draft'${feedbackScope} ORDER BY CASE WHEN f.due_at IS NULL OR f.due_at='' THEN 1 ELSE 0 END,f.due_at,f.updated_at LIMIT 8`),
    scoped(`SELECT lf.id,l.id AS lessonId,l.date AS dueAt,l.course_name AS courseName,l.topic,lf.updated_at AS updatedAt FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id WHERE lf.status='review'${lessonScope} ORDER BY l.date,lf.updated_at LIMIT 8`),
  ]), questionReviewSummary(db)]);
  const rows = (index: number) => results[index].results as Array<Record<string, any>>;
  const number = (index: number, key = "count") => Number(rows(index)[0]?.[key] || 0);
  const rate = (index: number) => { const total = number(index, "total"); return total ? Math.round(number(index, "done") / total * 100) : null; };
  const lessonIds = [...new Set([...rows(6), ...rows(15), ...rows(16), ...rows(19)].map((row) => Number(row.id)).filter(Boolean))], displayNames = new Map<number, string>();
  if (lessonIds.length) { const marks = lessonIds.map(() => "?").join(","), named = await db.prepare(`SELECT l.id,GROUP_CONCAT(s.name,'、') AS studentNames FROM lessons l LEFT JOIN enrollments e ON e.class_id=l.class_id AND e.status='active' LEFT JOIN students s ON s.id=e.student_id AND s.status='active' WHERE l.id IN (${marks}) GROUP BY l.id`).bind(...lessonIds).all<Record<string, unknown>>(); named.results.forEach((row) => displayNames.set(Number(row.id), String(row.studentNames || ""))); }
  const display = (row: Record<string, any>): Record<string, any> => ({ ...row, ...lessonDisplay({ ...row, studentNames: displayNames.get(Number(row.id)) || "" }) });
  const todayLessons = rows(6).map(display), upcomingLessons = rows(15).map(display), overdueLessons = rows(16).map(display), nextLesson = rows(19)[0] ? display(rows(19)[0]) : null;
  const actions: Action[] = [];
  for (const lesson of overdueLessons) actions.push({ key: `overdue-${lesson.id}`, type: "lesson-closeout", title: `补记：${lesson.topic || lesson.courseName}`, reason: "课时日期已过，课堂记录尚未完成", dueAt: lesson.date, href: `/lessons/${lesson.id}`, updatedAt: lesson.updatedAt });
  for (const lesson of todayLessons) if (lesson.status !== "completed") actions.push({ key: `today-${lesson.id}`, type: "today-lesson", title: `${lesson.prepReady ? "完成" : "备课"}：${lesson.topic || lesson.courseName}`, reason: lesson.prepReady ? "今天的课尚未完成课后记录" : "教学目标、重点或资料清单尚未补齐", dueAt: today, href: `/lessons/${lesson.id}` });
  if (nextLesson && !Number(nextLesson.prepReady) && nextLesson.date !== today) actions.push({ key: `next-${nextLesson.id}`, type: "lesson-prep", title: `准备下一节：${nextLesson.topic || nextLesson.courseName}`, reason: "下一节课的教学目标、重点或资料清单尚未补齐", dueAt: nextLesson.date, href: `/lessons/${nextLesson.id}` });
  for (const item of rows(20)) actions.push({ key: `assignment-${item.id}`, type: "assignment", title: `处理作业：${item.title}`, reason: `${item.pendingCount} 名学生待完成、订正或批改`, dueAt: String(item.dueAt || ""), href: `/assignments?lessonId=${item.lessonId || ""}&submissionStatus=pending`, updatedAt: item.updatedAt });
  for (const item of rows(21)) actions.push({ key: `feedback-${item.id}`, type: "feedback", title: `确认反馈：${item.subject}`, reason: "反馈仍为草稿，尚未确认", dueAt: String(item.dueAt || ""), href: `/feedback?lessonId=${item.lessonId || ""}&status=draft`, updatedAt: item.updatedAt });
  for (const item of rows(22)) actions.push({ key: `finance-${item.id}`, type: "finance", title: `核对结算：${item.topic || item.courseName}`, reason: "课时结算仍处于待核对状态", dueAt: String(item.dueAt || ""), href: `/finance?lessonId=${item.lessonId}&status=review`, updatedAt: item.updatedAt });
  for (const item of rows(9)) actions.push({ key: `student-${item.id}`, type: "student", title: `跟进学生：${item.name}`, reason: String(item.riskTags || "已有教师确认的关注事项"), dueAt: "", href: `/students/${item.id}`, updatedAt: item.updatedAt });
  let promotionDue = false;
  if (access.role === "teacher" && today.slice(5, 7) === "09") {
    const academicYear = `${today.slice(0, 4)}-${Number(today.slice(0, 4)) + 1}`, promotionRun = await ensurePromotionRun(db, academicYear);
    promotionDue = promotionRun?.status !== "confirmed";
    if (promotionDue) actions.push({ key: `promotion-${academicYear}`, type: "grade-promotion", title: "核对新学年年级晋升", reason: "9月已生成晋升建议；排除留级、转学或暂缓学生后再确认", dueAt: today, href: `/academic-years?year=${academicYear}` });
  }
  const bucket = (dueAt: string) => !dueAt ? 4 : dueAt < today ? 0 : dueAt === today ? 1 : dueAt <= shiftDate(today, 2) ? 2 : dueAt <= shiftDate(today, 7) ? 3 : 4;
  const suggestedActions = [...new Map(actions.map((item) => [item.key, item])).values()].sort((a, b) => bucket(a.dueAt) - bucket(b.dueAt) || String(a.dueAt || "9999").localeCompare(String(b.dueAt || "9999")) || String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""))).slice(0, 3);
  return Response.json({
    today, horizonDays, horizonDate, weekStart: monday, weekEnd: sunday, nextLesson, suggestedActions, promotionDue,
    weekLessons: number(0), draftLessons: number(1), confirmedFeedback: number(2), pendingFeedback: number(3), attendanceRate: rate(4), homeworkRate: rate(5), todayLessons,
    pendingHomework: number(7), riskCount: number(8), riskStudents: rows(9), recentReflections: access.role === "teacher" ? rows(10) : [], recentQuestions: rows(11), pendingReview: reviewSummary.total, reviewIssues: reviewSummary,
    activeClasses: number(12), activeStudents: number(13), pendingAssessments: number(14), upcomingLessons, overdueLessons, postLessonTodos: number(17), pendingFinance: number(18),
  });
}
