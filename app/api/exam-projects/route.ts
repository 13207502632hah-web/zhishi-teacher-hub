import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { academicYearDates, grades, graduationExams, regularExams, stageForGrade } from "../../lib/academic-workflow";

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, year = params.get("academicYear") || "";
  const rows = await env.DB.prepare(`SELECT ep.*,COUNT(eps.id) AS studentCount,SUM(CASE WHEN eps.status='recorded' THEN 1 ELSE 0 END) AS recordedCount FROM exam_projects ep LEFT JOIN exam_project_students eps ON eps.project_id=ep.id ${year ? "WHERE ep.academic_year=?" : ""} GROUP BY ep.id ORDER BY ep.academic_year DESC,CASE ep.category WHEN '第一次月考' THEN 1 WHEN '期中考试' THEN 2 WHEN '第二次月考' THEN 3 WHEN '期末考试' THEN 4 WHEN '一模' THEN 5 WHEN '二模' THEN 6 WHEN '三模' THEN 7 ELSE 8 END,ep.grade`).bind(...(year ? [year] : [])).all();
  return Response.json({ projects: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, academicYear = String(body.academicYear || "").trim(), dates = academicYearDates(academicYear);
  if (!dates) return Response.json({ error: "学年格式应为2025-2026，且结束年份必须比开始年份大1" }, { status: 400 });
  await env.DB.prepare("INSERT OR IGNORE INTO academic_years(name,start_date,end_date,status) VALUES(?,?,?,'active')").bind(academicYear, dates.startDate, dates.endDate).run();
  const active = (await env.DB.prepare("SELECT DISTINCT grade FROM students WHERE status='active' AND grade IS NOT NULL AND grade<>''").all<{ grade: string }>()).results.map((item) => item.grade).filter((grade) => grades.includes(grade));
  const statements = [];
  for (const grade of active) for (const category of [...regularExams, ...(graduationExams[grade] || [])]) statements.push(env.DB.prepare("INSERT OR IGNORE INTO exam_projects(academic_year,name,category,stage,grade,status) VALUES(?,?,?,?,?,'draft')").bind(academicYear, `${academicYear}学年${grade}${category}`, category, stageForGrade(grade), grade));
  if (statements.length) await env.DB.batch(statements);
  const projects = (await env.DB.prepare("SELECT id,grade FROM exam_projects WHERE academic_year=?").bind(academicYear).all<{ id: number; grade: string }>()).results;
  const members = [];
  for (const project of projects) members.push(env.DB.prepare("INSERT OR IGNORE INTO exam_project_students(project_id,student_id,status) SELECT ?,id,'pending' FROM students WHERE status='active' AND grade=?").bind(project.id, project.grade));
  if (members.length) await env.DB.batch(members);
  await audit(access, "generate", "exam_projects", null, { academicYear, projects: projects.length });
  return Response.json({ ok: true, academicYear, projectCount: projects.length, gradeCount: active.length }, { status: 201 });
}
