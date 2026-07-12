import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

const safeCell = (value: unknown) => { let text = String(value ?? ""); if (/^[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
const csv = (headers: string[], rows: unknown[][]) => `\uFEFF${[headers, ...rows].map((row) => row.map(safeCell).join(",")).join("\r\n")}`;

export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  const access = await requirePermission("settings:export"); if (isDenied(access)) return access;
  const type = (await context.params).type, url = new URL(request.url), assessmentId = Number(url.searchParams.get("assessmentId") || 0);
  let headers: string[] = [], rows: unknown[][] = [], label = "教学数据";
  if (type === "lessons") {
    const result = await env.DB.prepare("SELECT l.date,l.start_time,l.end_time,l.course_name,c.name AS className,l.topic,l.status,l.actual_content,l.homework,l.next_plan FROM lessons l LEFT JOIN classes c ON c.id=l.class_id ORDER BY l.date DESC,l.start_time").all();
    headers = ["日期","开始","结束","课程","班级","课题","状态","实际内容","作业","下节计划"]; rows = (result.results as any[]).map((item) => [item.date,item.start_time,item.end_time,item.course_name,item.className,item.topic,item.status,item.actual_content,item.homework,item.next_plan]); label = "课时记录";
  } else if (type === "students") {
    const result = await env.DB.prepare("SELECT s.name,s.grade,s.school,s.textbook_version,s.exam_goal,s.foundation_level,s.strengths,s.weak_knowledge,s.stage_goal,s.status,GROUP_CONCAT(c.name,'；') AS classes FROM students s LEFT JOIN enrollments e ON e.student_id=s.id AND e.status='active' LEFT JOIN classes c ON c.id=e.class_id GROUP BY s.id ORDER BY s.grade,s.name").all();
    headers = ["姓名","年级","学校","教材","考试目标","基础水平","优势","薄弱知识点","阶段目标","状态","班级"]; rows = (result.results as any[]).map((item) => [item.name,item.grade,item.school,item.textbook_version,item.exam_goal,item.foundation_level,item.strengths,item.weak_knowledge,item.stage_goal,item.status,item.classes]); label = "学生名单";
  } else if (type === "assessments") {
    const where = assessmentId ? "WHERE a.id=?" : "", result = await env.DB.prepare(`SELECT a.date,a.title,c.name AS className,a.type,a.total_score,s.name,s.grade,r.score,r.objective_score,r.subjective_score,r.weak_knowledge,r.teacher_note FROM assessments a JOIN classes c ON c.id=a.class_id LEFT JOIN assessment_results r ON r.assessment_id=a.id LEFT JOIN students s ON s.id=r.student_id ${where} ORDER BY a.date DESC,a.id,s.name`).bind(...(assessmentId ? [assessmentId] : [])).all();
    headers = ["日期","测验","班级","类型","总分","学生","年级","得分","客观题","主观题","薄弱知识点","教师备注"]; rows = (result.results as any[]).map((item) => [item.date,item.title,item.className,item.type,item.total_score,item.name,item.grade,item.score,item.objective_score,item.subjective_score,item.weak_knowledge,item.teacher_note]); label = assessmentId ? "单次测验成绩" : "测验成绩";
  } else if (type === "assignments") {
    const result = await env.DB.prepare("SELECT l.date,a.title,c.name AS className,s.name,sub.status,sub.score,sub.teacher_note,sub.submitted_at FROM assignment_submissions sub JOIN assignments a ON a.id=sub.assignment_id LEFT JOIN lessons l ON l.id=a.lesson_id LEFT JOIN classes c ON c.id=l.class_id JOIN students s ON s.id=sub.student_id ORDER BY l.date DESC,a.id,s.name").all();
    headers = ["课时日期","作业","班级","学生","状态","分数","教师备注","提交时间"]; rows = (result.results as any[]).map((item) => [item.date,item.title,item.className,item.name,item.status,item.score,item.teacher_note,item.submitted_at]); label = "作业完成情况";
  } else return Response.json({ error: "不支持的导出类型" }, { status: 404 });
  await audit(access, "export", type, assessmentId || null, { format: "csv", rows: rows.length });
  const filename = encodeURIComponent(`知师研室-${label}-${new Date().toISOString().slice(0,10)}.csv`);
  return new Response(csv(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${filename}`, "Cache-Control": "no-store" } });
}
