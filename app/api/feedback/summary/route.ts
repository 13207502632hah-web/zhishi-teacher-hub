import { env } from "cloudflare:workers";
import { isDenied, requireClassAccess, requirePermission, requireStudentAccess } from "../../../lib/access";

type Row = Record<string, unknown>;

const rate = (row: Row | null, done = "done", total = "total") => {
  const count = Number(row?.[total] || 0);
  return count ? Math.round(Number(row?.[done] || 0) / count * 100) : null;
};

export async function GET(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams;
  const classId = Number(params.get("classId") || 0);
  const studentId = Number(params.get("studentId") || 0);
  const end = params.get("end") || new Date().toISOString().slice(0, 10);
  const start = params.get("start") || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  if (!classId && !studentId) return Response.json({ error: "请先选择班级或学生" }, { status: 400 });
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  if (studentId) { const denied = await requireStudentAccess(access, studentId); if (denied) return denied; }

  const lessonWhere = ["l.date BETWEEN ? AND ?"];
  const lessonBind: unknown[] = [start, end];
  if (classId) { lessonWhere.push("l.class_id=?"); lessonBind.push(classId); }
  if (studentId) {
    lessonWhere.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id=l.class_id AND e.student_id=? AND e.status='active')");
    lessonBind.push(studentId);
  }
  const lessonFilter = lessonWhere.join(" AND ");

  const attendanceWhere = ["l.date BETWEEN ? AND ?"];
  const attendanceBind: unknown[] = [start, end];
  if (classId) { attendanceWhere.push("l.class_id=?"); attendanceBind.push(classId); }
  if (studentId) { attendanceWhere.push("a.student_id=?"); attendanceBind.push(studentId); }

  const homeworkWhere = ["l.date BETWEEN ? AND ?"];
  const homeworkBind: unknown[] = [start, end];
  if (classId) { homeworkWhere.push("l.class_id=?"); homeworkBind.push(classId); }
  if (studentId) { homeworkWhere.push("s.student_id=?"); homeworkBind.push(studentId); }

  const assessmentWhere = ["a.date BETWEEN ? AND ?"];
  const assessmentBind: unknown[] = [start, end];
  if (classId) { assessmentWhere.push("a.class_id=?"); assessmentBind.push(classId); }
  if (studentId) { assessmentWhere.push("r.student_id=?"); assessmentBind.push(studentId); }

  const performanceWhere = ["l.date BETWEEN ? AND ?"];
  const performanceBind: unknown[] = [start, end];
  if (classId) { performanceWhere.push("l.class_id=?"); performanceBind.push(classId); }
  if (studentId) { performanceWhere.push("r.student_id=?"); performanceBind.push(studentId); }

  const db = env.DB;
  const [lessonResult, attendanceResult, homeworkResult, assessmentResult, performanceResult, masteryResult, studentResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total,GROUP_CONCAT(DISTINCT COALESCE(NULLIF(l.topic,''),l.course_name)) AS topics FROM lessons l WHERE ${lessonFilter}`).bind(...lessonBind).first<Row>(),
    db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS done FROM attendance a JOIN lessons l ON l.id=a.lesson_id WHERE ${attendanceWhere.join(" AND ")}`).bind(...attendanceBind).first<Row>(),
    db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS done FROM assignment_submissions s JOIN assignments x ON x.id=s.assignment_id JOIN lessons l ON l.id=x.lesson_id WHERE ${homeworkWhere.join(" AND ")}`).bind(...homeworkBind).first<Row>(),
    db.prepare(`SELECT COUNT(*) AS total,AVG(r.score) AS average FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE ${assessmentWhere.join(" AND ")}`).bind(...assessmentBind).first<Row>(),
    db.prepare(`SELECT COUNT(*) AS total,AVG(r.participation) AS participation,AVG(r.understanding) AS understanding,AVG(r.completion) AS completion FROM student_lesson_records r JOIN lessons l ON l.id=r.lesson_id WHERE ${performanceWhere.join(" AND ")}`).bind(...performanceBind).first<Row>(),
    db.prepare(`SELECT GROUP_CONCAT(DISTINCT NULLIF(r.knowledge_mastery,'')) AS mastery FROM assessment_results r JOIN assessments a ON a.id=r.assessment_id WHERE ${assessmentWhere.join(" AND ")}`).bind(...assessmentBind).first<Row>(),
    studentId ? db.prepare("SELECT weak_knowledge AS weakKnowledge,risk_tags AS riskTags,risk_confirmed AS riskConfirmed FROM students WHERE id=?").bind(studentId).first<Row>() : Promise.resolve(null),
  ]);

  const lessons = Number(lessonResult?.total || 0);
  const attendance = rate(attendanceResult);
  const homework = rate(homeworkResult);
  const assessmentCount = Number(assessmentResult?.total || 0);
  const assessmentAverage = assessmentCount ? Math.round(Number(assessmentResult?.average || 0) * 10) / 10 : null;
  const topics = String(lessonResult?.topics || "").split(",").filter(Boolean);
  const facts = [`${start} 至 ${end} 共记录 ${lessons} 节课`];
  if (attendance !== null) facts.push(`出勤率 ${attendance}%`);
  if (homework !== null) facts.push(`作业完成率 ${homework}%`);
  if (assessmentAverage !== null) facts.push(`${assessmentCount} 次测验记录的平均分为 ${assessmentAverage} 分`);
  if (topics.length) facts.push(`涉及课题：${topics.slice(0, 8).join("、")}`);

  const performance: string[] = [];
  if (Number(performanceResult?.total || 0)) {
    performance.push(`课堂参与平均 ${Number(performanceResult?.participation || 0).toFixed(1)}/5`);
    performance.push(`理解度平均 ${Number(performanceResult?.understanding || 0).toFixed(1)}/5`);
    performance.push(`课堂完成度平均 ${Number(performanceResult?.completion || 0).toFixed(1)}/5`);
  }
  const problems = [String(studentResult?.weakKnowledge || ""), studentResult?.riskConfirmed ? String(studentResult?.riskTags || "") : "", String(masteryResult?.mastery || "")].filter(Boolean);

  return Response.json({
    range: { start, end },
    metrics: { lessons, attendance, homework, assessmentAverage, assessmentCount, topics, performanceRecords: Number(performanceResult?.total || 0) },
    draft: {
      periodSummary: facts.join("；") + "。",
      progress: performance.length ? performance.join("；") + "。以上为真实记录均值，请教师结合课堂证据补充进步描述。" : "暂无足够的课堂表现记录，请教师根据实际情况补充。",
      problems: problems.length ? `已有记录中的需关注项：${problems.join("；")}。请教师核对后保留或修改。` : "暂无已确认的需关注项，请教师根据实际情况补充。",
      evidenceRefs: [
        { sourceType: "lesson_summary", sourceId: null, label: `${start}至${end}课时汇总`, excerpt: facts.join("；"), sourceDate: end },
        ...(attendance !== null ? [{ sourceType: "attendance_summary", sourceId: null, label: "出勤记录汇总", excerpt: `出勤率${attendance}%`, sourceDate: end }] : []),
        ...(homework !== null ? [{ sourceType: "assignment_summary", sourceId: null, label: "作业记录汇总", excerpt: `完成率${homework}%`, sourceDate: end }] : []),
        ...(assessmentAverage !== null ? [{ sourceType: "assessment_summary", sourceId: null, label: "测验记录汇总", excerpt: `${assessmentCount}次测验平均${assessmentAverage}分`, sourceDate: end }] : []),
        ...(performance.length ? [{ sourceType: "lesson_record_summary", sourceId: null, label: "课堂表现记录汇总", excerpt: performance.join("；"), sourceDate: end }] : []),
      ],
    },
  });
}
