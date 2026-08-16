import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const clean = (value: unknown, maximum: number) => String(value || "").trim().slice(0, maximum);
const safeUrl = (value: string) => {
  if (!value) return true;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:read"); if (isDenied(access)) return access;
  const id = await idFrom(context); if (!Number.isInteger(id) || id < 1) return Response.json({ error: "资源编号无效" }, { status: 400 });
  const resource = await env.DB.prepare("SELECT id,owner_id AS ownerId,title,type,url,tags,content,source_ref AS sourceRef,visibility,created_at AS createdAt,updated_at AS updatedAt FROM resources WHERE id=?").bind(id).first<Record<string, unknown>>();
  if (!resource) return Response.json({ error: "资源不存在" }, { status: 404 });
  return Response.json({ resource }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("resources:write"); if (isDenied(access)) return access;
  const id = await idFrom(context); if (!Number.isInteger(id) || id < 1) return Response.json({ error: "资源编号无效" }, { status: 400 });
  const current = await env.DB.prepare("SELECT id,visibility FROM resources WHERE id=?").bind(id).first<{ id: number; visibility: string }>();
  if (!current) return Response.json({ error: "资源不存在" }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  const title = clean(body.title, 200), type = clean(body.type, 80), url = clean(body.url, 2000), tags = clean(body.tags, 1000), content = clean(body.content, 20_000);
  if (!title) return Response.json({ error: "资源名称不能为空" }, { status: 400 });
  if (!safeUrl(url)) return Response.json({ error: "外部链接只允许 http:// 或 https://" }, { status: 400 });
  await env.DB.prepare("UPDATE resources SET title=?,type=?,url=?,tags=?,content=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(title, type || null, url || null, tags || null, content || null, id).run();
  await audit(access, "update", "resource", id, { visibility: current.visibility, fields: ["title", "type", "url", "tags", "content"] });
  return GET(request, context);
}
