import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";

type Row = Record<string, unknown>;

const finiteNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read");
  if (isDenied(access)) return access;

  const requestedRange = new URL(request.url).searchParams.get("range");
  const range = requestedRange === "month" || requestedRange === "term" || requestedRange === "week" ? requestedRange : "week";
  const days = range === "week" ? 7 : range === "month" ? 30 : 180;
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const db = env.DB;
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN teaching_goals!='' AND key_points!='' THEN 1 ELSE 0 END) AS prepared FROM lessons WHERE date>=?").bind(start),
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN f.status='confirmed' THEN 1 ELSE 0 END) AS confirmed,SUM(CASE WHEN f.status='confirmed' AND l.id IS NOT NULL AND julianday(f.confirmed_at)-julianday(l.date)<=2 THEN 1 ELSE 0 END) AS timely FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE COALESCE(l.date,substr(f.created_at,1,10))>=?").bind(start),
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE l.date>=?").bind(start),
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE l.date>=?").bind(start),
    db.prepare("SELECT AVG(r.score) AS average,COUNT(r.score) AS total FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE a.date>=?").bind(start),
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN knowledge_points!='' THEN 1 ELSE 0 END) AS covered FROM questions WHERE status='active'"),
    db.prepare("SELECT difficulty,COUNT(*) AS count FROM questions WHERE status='active' GROUP BY difficulty ORDER BY difficulty"),
    db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN action_completed=1 THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN is_strategy=1 THEN 1 ELSE 0 END) AS strategies FROM reflections WHERE date>=?").bind(start),
    db.prepare("SELECT l.date,AVG(r.participation) AS participation,AVG(r.understanding) AS understanding FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE l.date>=? GROUP BY l.date ORDER BY l.date").bind(start),
    db.prepare("SELECT difficulties,COUNT(*) AS count FROM reflections WHERE date>=? AND difficulties!='' GROUP BY difficulties HAVING COUNT(*)>1 ORDER BY count DESC LIMIT 5").bind(start),
    db.prepare("SELECT l.date,COUNT(*) AS total,SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS completed FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN lessons l ON l.id=a.lesson_id WHERE l.date>=? GROUP BY l.date ORDER BY l.date").bind(start),
    db.prepare("SELECT knowledge_mastery AS mastery,COUNT(*) AS count FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE a.date>=? AND knowledge_mastery!='' GROUP BY knowledge_mastery ORDER BY count DESC LIMIT 8").bind(start),
    db.prepare("SELECT id,substr(stem,1,80) AS stem,use_count AS useCount FROM questions WHERE status='active' AND use_count>0 ORDER BY use_count DESC,updated_at DESC LIMIT 5"),
  ]);

  const row = (index: number) => results[index].results[0] as Row || {};
  const rate = (index: number, numerator = "done", denominator = "total") => {
    const top = finiteNumber(row(index)[numerator]);
    const bottom = finiteNumber(row(index)[denominator]);
    if (top === null || bottom === null || bottom <= 0) return null;
    return Math.round(Math.min(100, Math.max(0, top / bottom * 100)));
  };
  const assessmentAverage = finiteNumber(row(4).average);
  const assessmentCount = finiteNumber(row(4).total);

  return Response.json({
    range,
    start,
    teaching: {
      lessons: finiteNumber(row(0).total) ?? 0,
      completedRate: rate(0, "completed"),
      prepRate: rate(0, "prepared"),
      feedbackRate: rate(1, "timely"),
    },
    classroom: {
      attendanceRate: rate(2),
      homeworkRate: rate(3),
      assessmentAverage: assessmentCount !== null && assessmentCount > 0 && assessmentAverage !== null ? Math.round(assessmentAverage * 10) / 10 : null,
      assessmentCount: assessmentCount !== null && assessmentCount > 0 ? assessmentCount : 0,
      knowledgeMastery: results[11].results,
    },
    questionBank: {
      total: finiteNumber(row(5).total) ?? 0,
      coverageRate: rate(5, "covered"),
      difficulty: results[6].results,
      frequent: results[12].results,
    },
    growth: {
      reflections: finiteNumber(row(7).total) ?? 0,
      actionRate: rate(7, "completed"),
      strategies: finiteNumber(row(7).strategies) ?? 0,
      repeatedProblems: results[9].results,
    },
    studentTrend: results[8].results,
    homeworkTrend: results[10].results,
  });
}
