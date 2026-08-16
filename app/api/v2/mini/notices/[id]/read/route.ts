import { env } from "cloudflare:workers";
import { miniDenied, requireMini } from "../../../../../../lib/mini-auth";
import { accessibleStudentIds, recordSyncEvent } from "../../../../../../lib/services/mini-sync-service";

const clean = (value: unknown, max: number) => String(value || "").trim().slice(0, max);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireMini(request); if (miniDenied(access)) return access;
  const id = Number((await context.params).id), payload = await request.json().catch(() => ({})) as Record<string, unknown>, studentId = Number(payload.studentId || 0), action = payload.action === "acknowledge" ? "acknowledge" : "read", operationId = clean(payload.operationId || request.headers.get("x-operation-id"), 160);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(studentId) || studentId < 1) return Response.json({ error: "通知或学生编号无效" }, { status: 400 });
  if (!operationId) return Response.json({ error: "operationId 不能为空" }, { status: 400 });
  const allowed = await accessibleStudentIds(access); if (!allowed.includes(studentId)) return Response.json({ error: "无权确认该学生的通知" }, { status: 403 });
  const notice = await env.DB.prepare("SELECT n.id,n.title FROM class_notices n JOIN enrollments e ON e.class_id=n.class_id AND e.student_id=? AND e.status='active' WHERE n.id=? AND n.status='published' AND (n.audience_role='both' OR n.audience_role=?)").bind(studentId, id, access.role).first<Record<string, unknown>>();
  if (!notice) return Response.json({ error: "通知不存在、已撤回或不属于当前身份" }, { status: 404 });
  if (action === "acknowledge") await env.DB.prepare("INSERT INTO notice_receipts(notice_id,account_id,student_id,role,operation_id,read_at,acknowledged_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(notice_id,account_id,student_id) DO UPDATE SET read_at=COALESCE(notice_receipts.read_at,CURRENT_TIMESTAMP),acknowledged_at=COALESCE(notice_receipts.acknowledged_at,CURRENT_TIMESTAMP),role=excluded.role,operation_id=excluded.operation_id,updated_at=CURRENT_TIMESTAMP").bind(id, access.accountId, studentId, access.role, operationId).run();
  else await env.DB.prepare("INSERT INTO notice_receipts(notice_id,account_id,student_id,role,operation_id,read_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(notice_id,account_id,student_id) DO UPDATE SET read_at=COALESCE(notice_receipts.read_at,CURRENT_TIMESTAMP),role=excluded.role,operation_id=excluded.operation_id,updated_at=CURRENT_TIMESTAMP").bind(id, access.accountId, studentId, access.role, operationId).run();
  const receipt = await env.DB.prepare("SELECT read_at AS readAt,acknowledged_at AS acknowledgedAt FROM notice_receipts WHERE notice_id=? AND account_id=? AND student_id=?").bind(id, access.accountId, studentId).first<Record<string, unknown>>();
  await recordSyncEvent({ eventType: action === "acknowledge" ? "class_notice.acknowledged" : "class_notice.read", entityType: "class_notice", entityId: id, studentId, accountId: access.accountId, audienceRole: "teacher", payload: { role: access.role, title: notice.title } });
  return Response.json({ ok: true, action, receipt }, { headers: { "Cache-Control": "private, no-store" } });
}
