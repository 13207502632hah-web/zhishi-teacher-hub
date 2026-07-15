import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../lib/access";

const allowed = new Set(["assignment", "feedback", "next_plan"]);
const cleanType = (value: unknown) => allowed.has(String(value || "")) ? String(value) : "";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const type = cleanType(new URL(request.url).searchParams.get("type")), where = type ? "WHERE status='active' AND type=?" : "WHERE status='active'", rows = await env.DB.prepare(`SELECT id,owner_id AS ownerId,type,name,payload_json AS payloadJson,is_default AS isDefault,updated_at AS updatedAt FROM workflow_templates ${where} ORDER BY is_default DESC,updated_at DESC`).bind(...(type ? [type] : [])).all<Record<string, any>>();
  return Response.json({ templates: rows.results.map((row) => { let payload = {}; try { payload = JSON.parse(String(row.payloadJson || "{}")); } catch { payload = {}; } return { ...row, payload }; }) });
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; if (access.role !== "teacher") return Response.json({ error: "助教可以使用模板，但只有教师可以管理模板" }, { status: 403 });
  const body = await request.json() as Record<string, any>, type = cleanType(body.type), name = String(body.name || "").trim(); if (!type || !name) return Response.json({ error: "模板类型和名称不能为空" }, { status: 400 });
  const payload = JSON.stringify(body.payload || {}); if (payload.length > 20_000) return Response.json({ error: "模板内容过长" }, { status: 413 });
  const row = await env.DB.prepare("INSERT INTO workflow_templates(owner_id,type,name,payload_json,is_default,status) VALUES(?,?,?,?,?,'active') ON CONFLICT(owner_id,type,name) DO UPDATE SET payload_json=excluded.payload_json,is_default=excluded.is_default,status='active',updated_at=CURRENT_TIMESTAMP RETURNING id").bind(access.id, type, name, payload, body.isDefault ? 1 : 0).first<{ id: number }>();
  await audit(access, "save", "workflow_template", row?.id, { type, name }); return Response.json({ ok: true, id: row?.id }, { status: 201 });
}

export async function PUT(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; if (access.role !== "teacher") return Response.json({ error: "只有教师可以修改模板" }, { status: 403 });
  const body = await request.json() as Record<string, any>, id = Number(body.id || 0), type = cleanType(body.type), name = String(body.name || "").trim(); if (!id || !type || !name) return Response.json({ error: "模板信息不完整" }, { status: 400 });
  const result = await env.DB.prepare("UPDATE workflow_templates SET type=?,name=?,payload_json=?,is_default=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(type, name, JSON.stringify(body.payload || {}), body.isDefault ? 1 : 0, id, access.id).run();
  return Number(result.meta?.changes || 0) ? Response.json({ ok: true }) : Response.json({ error: "模板不存在或无权修改" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; if (access.role !== "teacher") return Response.json({ error: "只有教师可以停用模板" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id") || 0), result = await env.DB.prepare("UPDATE workflow_templates SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(id, access.id).run();
  return Number(result.meta?.changes || 0) ? Response.json({ ok: true }) : Response.json({ error: "模板不存在或无权停用" }, { status: 404 });
}
