import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../lib/access";

const clean = (value: unknown, max: number) => String(value || "").trim().slice(0, max);

export async function GET(request: Request) {
  const access = await requirePermission("feedback:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, classId = Number(params.get("classId") || 0), status = clean(params.get("status"), 20) || "active";
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const where: string[] = [], bind: unknown[] = [];
  if (access.role === "teacher") { where.push("(c.owner_id IS NULL OR c.owner_id=?)"); bind.push(access.id); }
  if (access.role === "assistant") { where.push("EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=n.class_id AND sca.user_id=?)"); bind.push(access.id); }
  if (classId) { where.push("n.class_id=?"); bind.push(classId); }
  if (status === "archived") where.push("n.status='archived'"); else if (status !== "all") where.push("n.status!='archived'");
  const rows = await env.DB.prepare(`SELECT n.id,n.class_id AS classId,n.title,n.content,n.audience_role AS audienceRole,n.status,n.published_at AS publishedAt,n.created_at AS createdAt,n.updated_at AS updatedAt,c.name AS className,u.name AS createdByName,
    (SELECT COUNT(*) FROM mini_bindings mb JOIN enrollments e ON e.student_id=mb.student_id AND e.status='active' WHERE e.class_id=n.class_id AND mb.status='active' AND (n.audience_role='both' OR mb.role=n.audience_role)) AS recipientCount,
    (SELECT COUNT(*) FROM notice_receipts nr WHERE nr.notice_id=n.id AND nr.read_at IS NOT NULL) AS readCount,
    (SELECT COUNT(*) FROM notice_receipts nr WHERE nr.notice_id=n.id AND nr.acknowledged_at IS NOT NULL) AS acknowledgedCount
    FROM class_notices n JOIN classes c ON c.id=n.class_id JOIN users u ON u.id=n.created_by WHERE ${where.length ? where.join(" AND ") : "1=1"} ORDER BY n.updated_at DESC,n.id DESC LIMIT 300`).bind(...bind).all<Record<string, unknown>>();
  const notices = rows.results, published = notices.filter((item) => item.status === "published"), recipients = published.reduce((sum, item) => sum + Number(item.recipientCount || 0), 0), reads = published.reduce((sum, item) => sum + Number(item.readCount || 0), 0);
  return Response.json({ notices, counts: { total: notices.length, draft: notices.filter((item) => item.status === "draft").length, published: published.length, recipients, reads, unread: Math.max(0, recipients - reads) } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>, classId = Number(payload.classId || 0), title = clean(payload.title, 160), content = clean(payload.content, 8000), operationId = clean(payload.operationId || request.headers.get("x-operation-id"), 160), audienceRole = clean(payload.audienceRole, 20) || "both";
  if (!Number.isInteger(classId) || classId < 1) return Response.json({ error: "请选择班级" }, { status: 400 });
  const denied = await requireClassAccess(access, classId); if (denied) return denied;
  if (!title || !content) return Response.json({ error: "通知标题和正文不能为空" }, { status: 400 });
  if (!operationId) return Response.json({ error: "operationId 不能为空" }, { status: 400 });
  if (!["student", "parent", "both"].includes(audienceRole)) return Response.json({ error: "接收身份无效" }, { status: 400 });
  const repeated = await env.DB.prepare("SELECT id,status FROM class_notices WHERE created_by=? AND operation_id=?").bind(access.id, operationId).first();
  if (repeated) return Response.json({ notice: repeated, repeated: true });
  const row = await env.DB.prepare("INSERT INTO class_notices(class_id,title,content,audience_role,status,operation_id,created_by) VALUES(?,?,?,?,'draft',?,?) RETURNING id,status,created_at AS createdAt").bind(classId, title, content, audienceRole, operationId, access.id).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "通知草稿保存失败" }, { status: 500 });
  await audit(access, "create", "class_notice", String(row.id), { classId, audienceRole, status: "draft" });
  return Response.json({ notice: { ...row, classId, title, content, audienceRole } }, { status: 201 });
}
