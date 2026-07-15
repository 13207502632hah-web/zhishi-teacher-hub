import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";

const chinaDate = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const shift = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };

export async function GET() {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const today = chinaDate(new Date()), start = shift(today, -27), midpoint = shift(today, -13), previousEnd = shift(midpoint, -1), scope = access.role === "assistant" ? "AND EXISTS(SELECT 1 FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE e.student_id=s.id AND e.status='active' AND sca.user_id=?)" : "", students = await env.DB.prepare(`SELECT s.id,s.name,s.grade,s.risk_confirmed AS riskConfirmed,s.risk_tags AS riskTags FROM students s WHERE s.status='active' ${scope} ORDER BY s.name`).bind(...(access.role === "assistant" ? [access.id] : [])).all<Record<string, any>>(), result: Array<Record<string, any>> = [];
  for (const student of students.results) {
    const [overdue, attendance, scores, understanding] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM assignment_submissions x JOIN assignments a ON a.id=x.assignment_id WHERE x.student_id=? AND x.status NOT IN ('completed','corrected') AND a.due_at IS NOT NULL AND date(a.due_at)<?").bind(student.id, today).first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE a.student_id=? AND l.date BETWEEN ? AND ? AND a.status IN ('late','absent','leave')").bind(student.id, start, today).first<{ count: number }>(),
      env.DB.prepare("SELECT r.score,a.total_score AS totalScore FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE r.student_id=? AND r.score IS NOT NULL ORDER BY a.date DESC LIMIT 2").bind(student.id).all<Record<string, any>>(),
      env.DB.prepare("SELECT AVG(CASE WHEN l.date BETWEEN ? AND ? THEN r.understanding END) AS early,COUNT(CASE WHEN l.date BETWEEN ? AND ? AND r.understanding IS NOT NULL THEN 1 END) AS earlyCount,AVG(CASE WHEN l.date BETWEEN ? AND ? THEN r.understanding END) AS recent,COUNT(CASE WHEN l.date BETWEEN ? AND ? AND r.understanding IS NOT NULL THEN 1 END) AS recentCount FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE r.student_id=? AND l.date BETWEEN ? AND ?").bind(start, previousEnd, start, previousEnd, midpoint, today, midpoint, today, student.id, start, today).first<Record<string, any>>(),
    ]);
    const reasons: Array<{ level: number; label: string; evidence: string }> = [];
    if (student.riskConfirmed) reasons.push({ level: 3, label: "教师确认关注", evidence: student.riskTags || "教师已在学生档案中确认关注" });
    if (Number(overdue?.count || 0) >= 2) reasons.push({ level: 3, label: "逾期作业", evidence: `当前有${overdue?.count}项逾期作业未完成或订正` });
    if (Number(attendance?.count || 0) >= 2) reasons.push({ level: 2, label: "异常出勤", evidence: `近四周记录${attendance?.count}次迟到、缺勤或请假` });
    if (scores.results.length >= 2) { const current = Number(scores.results[0].score) / Math.max(1, Number(scores.results[0].totalScore)) * 100, previous = Number(scores.results[1].score) / Math.max(1, Number(scores.results[1].totalScore)) * 100; if (previous - current >= 8) reasons.push({ level: 3, label: "测验下降", evidence: `最近两次得分率${Math.round(previous)}%→${Math.round(current)}%` }); }
    if (Number(understanding?.earlyCount || 0) > 0 && Number(understanding?.recentCount || 0) > 0 && Number(understanding?.early || 0) - Number(understanding?.recent || 0) >= 1) reasons.push({ level: 2, label: "理解度下降", evidence: `前两周均值${Number(understanding?.early).toFixed(1)}，后两周${Number(understanding?.recent).toFixed(1)}` });
    if (reasons.length) result.push({ id: student.id, name: student.name, grade: student.grade, severity: Math.max(...reasons.map((item) => item.level)), reasons });
  }
  result.sort((a, b) => Number(b.severity) - Number(a.severity) || b.reasons.length - a.reasons.length || String(a.name).localeCompare(String(b.name), "zh-CN"));
  return Response.json({ students: result, range: { start, today }, rules: ["教师确认关注", "两项及以上逾期作业", "两次及以上异常出勤", "最近两次测验下降至少8个百分点", "后两周理解度比前两周下降至少1分"] });
}
