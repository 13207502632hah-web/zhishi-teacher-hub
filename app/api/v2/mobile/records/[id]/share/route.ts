import { audit, isDenied, requirePermission } from "../../../../../../lib/access";
import { createApproval } from "../../../../../../lib/v2/approval-service";
import { listMobileRecords } from "../../../../../../lib/v2/mobile-record-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const { id } = await context.params, body = await request.json().catch(() => ({})) as Record<string, unknown>, audience = String(body.audience || "both");
  if (!['student','parent','both'].includes(audience)) return Response.json({ error: "共享对象无效" }, { status: 400 });
  const record = (await listMobileRecords(access, 0, 200)).records.find((item) => item.id === id);
  if (!record) return Response.json({ error: "记录不存在" }, { status: 404 });
  if (!record.studentId && !record.classId) return Response.json({ error: "请先关联学生或班级再申请共享" }, { status: 400 });
  const approval = await createApproval(access, { actionType: "mobile_record.share", entityType: "mobile_record", entityId: id, title: `共享移动记录：${record.title}`, summary: record.content.slice(0, 500), payload: { id, audience, version: record.version }, evidence: [{ source: record.source, occurredAt: record.occurredAt, lessonId: record.lessonId, classId: record.classId, studentId: record.studentId }], confidence: 1 });
  await audit(access, "mobile_record_share_requested", "mobile_record", id, { approvalId: approval?.id, audience });
  return Response.json({ approval }, { status: 201 });
}
