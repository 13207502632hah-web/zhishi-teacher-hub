import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), paper = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(id).first();
  if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const files = await env.DB.prepare("SELECT id,version_type AS versionType,original_name AS originalName,mime_type AS mimeType,size,parse_status AS parseStatus,parse_message AS parseMessage,created_at AS createdAt FROM paper_files WHERE paper_id=? ORDER BY created_at DESC,id DESC").bind(id).all();
  return Response.json({ files: files.results });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("papers:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), body = await request.json() as Record<string, unknown>, classId = Number(body.classId || 0), studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(Number).filter((item) => item > 0) : [], dueAt = String(body.dueAt || ""), title = String(body.title || "完整试卷作业");
  const paper = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(id).first(); if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
  const assignment = await env.DB.prepare("INSERT INTO assignments(paper_id,title,requirements,due_at) VALUES(?,?,?,?) RETURNING id").bind(id, title, String(body.requirements || "完成整张试卷并订正错题"), dueAt || null).first<{ id: number }>();
  let ids = studentIds;
  if (!ids.length && classId) ids = (await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(classId).all<{ studentId: number }>()).results.map((row) => row.studentId);
  if (ids.length) await env.DB.batch(ids.map((studentId) => env.DB.prepare("INSERT OR IGNORE INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,'pending')").bind(assignment?.id, studentId)));
  await env.DB.prepare("UPDATE papers SET use_status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
  await audit(access, "assign_whole_paper", "paper", id, { assignmentId: assignment?.id, studentCount: ids.length, dueAt });
  return Response.json({ assignmentId: assignment?.id, studentCount: ids.length });
}

