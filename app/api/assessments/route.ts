import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../lib/access";

const text = (value: unknown) => String(value || "").trim();

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, classId = Number(params.get("classId") || 0), status = params.get("status") || "all";
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const where: string[] = [], bind: unknown[] = [];
  if (classId) { where.push("a.class_id=?"); bind.push(classId); }
  if (status !== "all") { where.push("a.status=?"); bind.push(status); }
  const rows = await env.DB.prepare(`SELECT a.id,a.title,a.date,a.total_score AS totalScore,a.type,a.status,a.notes,a.class_id AS classId,a.paper_id AS paperId,c.name AS className,p.title AS paperTitle,COUNT(r.id) AS resultCount,ROUND(AVG(r.score),1) AS averageScore FROM assessments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN papers p ON p.id=a.paper_id LEFT JOIN assessment_results r ON r.assessment_id=a.id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY a.id ORDER BY a.date DESC,a.updated_at DESC`).bind(...bind).all();
  return Response.json({ assessments: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, classId = Number(body.classId), paperId = body.paperId ? Number(body.paperId) : null, totalScore = Number(body.totalScore), title = text(body.title), date = text(body.date);
  if (!title || !date || !Number.isFinite(classId) || classId <= 0) return Response.json({ error: "测验名称、日期和班级为必填项" }, { status: 400 });
  if (!Number.isFinite(totalScore) || totalScore <= 0 || totalScore > 1000) return Response.json({ error: "总分必须在 1 到 1000 之间" }, { status: 400 });
  const denied = await requireClassAccess(access, classId); if (denied) return denied;
  if (paperId) { const paper = await env.DB.prepare("SELECT id FROM papers WHERE id=?").bind(paperId).first(); if (!paper) return Response.json({ error: "关联试卷不存在" }, { status: 400 }); }
  const row = await env.DB.prepare("INSERT INTO assessments(class_id,paper_id,title,date,total_score,type,status,notes) VALUES(?,?,?,?,?,?,?,?) RETURNING id,title,date,total_score AS totalScore,type,status").bind(classId, paperId, title, date, totalScore, text(body.type) || "课堂测验", text(body.status) || "draft", text(body.notes)).first();
  await audit(access, "create", "assessment", Number((row as { id?: number })?.id), { classId, totalScore });
  return Response.json({ assessment: row }, { status: 201 });
}
