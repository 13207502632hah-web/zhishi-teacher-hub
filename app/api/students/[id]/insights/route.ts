import { env } from "cloudflare:workers";
import { isDenied, requirePermission, requireStudentAccess } from "../../../../lib/access";

const chinaDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const shift = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
const average = (items: number[]) => items.length ? items.reduce((sum, value) => sum + value, 0) / items.length : null;
const trend = (early: number | null, recent: number | null, threshold = 0.01) => early == null || recent == null ? { label: "数据不足", delta: null } : { label: recent - early >= threshold ? "上升" : early - recent >= threshold ? "下降" : "基本稳定", delta: Number((recent - early).toFixed(1)) };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const weeks = Math.max(1, Math.min(12, Number(new URL(request.url).searchParams.get("weeks") || 4))), today = chinaDate(new Date()), start = shift(today, -(weeks * 7 - 1)), midpoint = shift(today, -13), previousEnd = shift(midpoint, -1);
  const [attendance, assignments, assessments, records, observations, wrongQuestions] = await Promise.all([
    env.DB.prepare("SELECT l.id AS lessonId,l.date,l.topic,l.course_name AS courseName,a.status,a.notes FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE a.student_id=? AND l.date BETWEEN ? AND ? ORDER BY l.date DESC").bind(id, start, today).all<Record<string, any>>(),
    env.DB.prepare("SELECT a.id AS assignmentId,a.title,a.due_at AS dueAt,a.created_at AS createdAt,s.status,s.submitted_at AS submittedAt FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.student_id=? AND date(COALESCE(s.submitted_at,a.due_at,a.created_at)) BETWEEN ? AND ? ORDER BY COALESCE(s.submitted_at,a.due_at,a.created_at) DESC").bind(id, start, today).all<Record<string, any>>(),
    env.DB.prepare("SELECT a.id AS assessmentId,a.title,a.date,a.total_score AS totalScore,r.score FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE r.student_id=? AND a.date BETWEEN ? AND ? ORDER BY a.date DESC").bind(id, start, today).all<Record<string, any>>(),
    env.DB.prepare("SELECT l.id AS lessonId,l.date,l.topic,l.course_name AS courseName,r.participation,r.understanding,r.completion,r.teacher_note AS teacherNote,r.risk_tags AS riskTags,r.risk_confirmed AS riskConfirmed FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.student_id=? AND l.date BETWEEN ? AND ? ORDER BY l.date DESC").bind(id, start, today).all<Record<string, any>>(),
    env.DB.prepare("SELECT id,lesson_id AS lessonId,created_at AS createdAt,content,status FROM feedback WHERE student_id=? AND status='confirmed' AND date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC").bind(id, start, today).all<Record<string, any>>(),
    env.DB.prepare("SELECT w.id,w.question_id AS questionId,w.lesson_id AS lessonId,w.status,w.occurred_at AS occurredAt,w.mastered_at AS masteredAt,q.stem,q.knowledge_points AS knowledgePoints FROM wrong_questions w JOIN questions q ON q.id=w.question_id WHERE w.student_id=? AND date(w.occurred_at) BETWEEN ? AND ? ORDER BY w.occurred_at DESC").bind(id, start, today).all<Record<string, any>>(),
  ]);
  const split = <T extends Record<string, any>>(items: T[], date: (item: T) => string) => ({ early: items.filter((item) => date(item) >= start && date(item) <= previousEnd), recent: items.filter((item) => date(item) >= midpoint && date(item) <= today) });
  const attendanceRate = (items: Array<Record<string, any>>) => items.length ? items.filter((item) => ["present", "late"].includes(String(item.status))).length / items.length * 100 : null;
  const homeworkRate = (items: Array<Record<string, any>>) => items.length ? items.filter((item) => ["completed", "corrected"].includes(String(item.status))).length / items.length * 100 : null;
  const assessmentRate = (items: Array<Record<string, any>>) => average(items.filter((item) => item.score != null).map((item) => Number(item.score) / Math.max(1, Number(item.totalScore || 100)) * 100));
  const recordAverage = (items: Array<Record<string, any>>, key: string) => average(items.filter((item) => item[key] != null).map((item) => Number(item[key])));
  const a = split(attendance.results, (item) => item.date), h = split(assignments.results, (item) => String(item.submittedAt || item.dueAt || item.createdAt).slice(0, 10)), s = split(assessments.results, (item) => item.date), r = split(records.results, (item) => item.date);
  const metrics = {
    attendance: { total: attendance.results.length, present: attendance.results.filter((item) => item.status === "present").length, late: attendance.results.filter((item) => item.status === "late").length, absent: attendance.results.filter((item) => item.status === "absent").length, leave: attendance.results.filter((item) => item.status === "leave").length, rate: attendanceRate(attendance.results), trend: trend(attendanceRate(a.early), attendanceRate(a.recent), 1) },
    homework: { total: assignments.results.length, completed: assignments.results.filter((item) => ["completed", "corrected"].includes(String(item.status))).length, pending: assignments.results.filter((item) => !["completed", "corrected"].includes(String(item.status))).length, rate: homeworkRate(assignments.results), trend: trend(homeworkRate(h.early), homeworkRate(h.recent), 1) },
    assessment: { total: assessments.results.length, rate: assessmentRate(assessments.results), trend: trend(assessmentRate(s.early), assessmentRate(s.recent), 1) },
    classroom: { total: records.results.length, participation: recordAverage(records.results, "participation"), understanding: recordAverage(records.results, "understanding"), completion: recordAverage(records.results, "completion"), understandingTrend: trend(recordAverage(r.early, "understanding"), recordAverage(r.recent, "understanding"), .2), observationCount: records.results.filter((item) => String(item.teacherNote || "").trim()).length + observations.results.length },
  };
  const timeline = [
    ...attendance.results.map((item) => ({ date: item.date, type: "出勤", title: item.topic || item.courseName, detail: item.status, href: `/lessons/${item.lessonId}` })),
    ...assignments.results.map((item) => ({ date: String(item.submittedAt || item.dueAt || item.createdAt).slice(0, 10), type: item.status === "corrected" || item.status === "revision" || item.status === "revision_submitted" ? "订正" : "作业", title: item.title, detail: item.status, href: `/assignments?q=${encodeURIComponent(String(item.title || ""))}&submissionStatus=${item.status}` })),
    ...assessments.results.map((item) => ({ date: item.date, type: "测验", title: item.title, detail: item.score == null ? "待录入" : `${item.score}/${item.totalScore}`, href: "/assessments" })),
    ...records.results.filter((item) => item.teacherNote || item.riskConfirmed).map((item) => ({ date: item.date, type: "教师观察", title: item.topic || item.courseName, detail: item.teacherNote || item.riskTags || "教师已确认关注", href: `/lessons/${item.lessonId}` })),
    ...observations.results.map((item) => ({ date: String(item.createdAt).slice(0, 10), type: "已确认反馈", title: "课程反馈", detail: String(item.content || "").slice(0, 120), href: `/feedback?studentId=${id}&status=confirmed` })),
    ...wrongQuestions.results.map((item) => ({ date: String(item.masteredAt || item.occurredAt).slice(0, 10), type: "错题", title: String(item.stem || "政治错题").slice(0, 100), detail: item.status === "mastered" ? "已掌握" : `待巩固${item.knowledgePoints ? ` · ${item.knowledgePoints}` : ""}`, href: `/students/${id}#wrong-questions` })),
  ].sort((left, right) => String(right.date).localeCompare(String(left.date)));
  return Response.json({ range: { start, today, midpoint, weeks }, metrics, timeline });
}
