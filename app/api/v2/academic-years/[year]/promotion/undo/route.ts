import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../../../lib/access";
import { createApproval } from "../../../../../../lib/v2/approval-service";

export async function POST(request: Request, context: { params: Promise<{ year: string }> }) {
  const access = await requirePermission("academic-years:write");
  if (isDenied(access)) return access;
  if (access.role !== "teacher") return Response.json({ error: "只有主教师可以申请撤销学年晋升" }, { status: 403 });
  let year = ""; try { year = decodeURIComponent((await context.params).year).trim(); } catch { return Response.json({ error: "学年格式无效" }, { status: 400 }); }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>, operationId = String(body.operationId || request.headers.get("x-operation-id") || "").trim();
  if (!operationId) return Response.json({ error: "operationId 不能为空" }, { status: 400 });
  const run = await env.DB.prepare("SELECT id,status,confirmed_at AS confirmedAt,undo_until AS undoUntil,CASE WHEN datetime(undo_until)>datetime('now') THEN 1 ELSE 0 END AS undoOpen FROM grade_promotion_runs WHERE academic_year=?").bind(year).first<{ id: number; status: string; confirmedAt: string | null; undoUntil: string | null; undoOpen: number }>();
  if (!run || run.status !== "confirmed") return Response.json({ error: "该学年没有可撤销的已确认晋升" }, { status: 409 });
  if (!run.undoUntil || Number(run.undoOpen) !== 1) return Response.json({ error: "24 小时安全撤销窗口已结束" }, { status: 409 });
  const conflicts = await env.DB.prepare("SELECT i.student_id AS studentId,i.to_grade AS expectedGrade,s.grade AS currentGrade,s.status AS studentStatus FROM grade_promotion_items i LEFT JOIN students s ON s.id=i.student_id WHERE i.run_id=? AND i.status='confirmed' AND (s.id IS NULL OR s.status!='active' OR s.grade!=i.to_grade)").bind(run.id).all<Record<string, unknown>>();
  if (conflicts.results.length) return Response.json({ error: "部分学生档案在晋升后已变化，不能自动撤销", conflicts: conflicts.results }, { status: 409 });
  const existing = await env.DB.prepare("SELECT id,state FROM v2_approvals WHERE user_id=? AND action_type='academic_year.undo' AND entity_id=? AND json_extract(payload_json,'$.operationId')=? ORDER BY created_at DESC LIMIT 1").bind(access.id, year, operationId).first<Record<string, unknown>>();
  if (existing) return Response.json({ approval: existing, repeated: true });
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM grade_promotion_items WHERE run_id=? AND status='confirmed'").bind(run.id).first<{ total: number }>();
  const approval = await createApproval(access, { actionType: "academic_year.undo", entityType: "academic_year", entityId: year, title: `撤销 ${year} 学年晋升`, summary: `将在安全窗口内把 ${Number(count?.total || 0)} 名学生恢复到晋升前年级；执行时会再次检查档案未发生变化。`, payload: { academicYear: year, runId: run.id, expectedConfirmedAt: run.confirmedAt, undoUntil: run.undoUntil, operationId, reason: String(body.reason || "").slice(0, 500) }, evidence: [{ type: "promotion_undo_window", runId: run.id, confirmedAt: run.confirmedAt, undoUntil: run.undoUntil, affectedStudents: Number(count?.total || 0) }] });
  await audit(access, "approval_created", "grade_promotion_undo", run.id, { academicYear: year, approvalId: approval?.id, operationId });
  return Response.json({ approval }, { status: 201 });
}
