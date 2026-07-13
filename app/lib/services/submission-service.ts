import { env } from "cloudflare:workers";
import type { MiniAccess } from "../mini-auth";
import { beginOperation, completeOperation, abandonOperation } from "./idempotency";
import { accessibleStudentIds, recordSyncEvent } from "./mini-sync-service";

export async function listSubmissions(access: MiniAccess, assignmentId: number) {
  const bind: unknown[] = [assignmentId];
  let scope = "";
  if (access.role !== "teacher") {
    const ids = await accessibleStudentIds(access);
    if (!ids.length) return [];
    scope = ` AND s.student_id IN (${ids.map(() => "?").join(",")})`;
    bind.push(...ids);
  }
  const rows = await env.DB.prepare(`SELECT s.id,s.assignment_id AS assignmentId,s.student_id AS studentId,st.name AS studentName,s.status,s.score,s.review_tags AS reviewTags,s.teacher_note AS teacherNote,s.submitted_at AS submittedAt,s.updated_at AS updatedAt,(SELECT MAX(version) FROM submission_versions WHERE submission_id=s.id) AS latestVersion,(SELECT teacher_note FROM submission_reviews WHERE submission_id=s.id AND status='confirmed' ORDER BY id DESC LIMIT 1) AS confirmedNote,(SELECT revision_requirements FROM submission_reviews WHERE submission_id=s.id AND status='confirmed' ORDER BY id DESC LIMIT 1) AS revisionRequirements FROM assignment_submissions s JOIN students st ON st.id=s.student_id WHERE s.assignment_id=?${scope} ORDER BY st.name`)
    .bind(...bind).all();
  return rows.results;
}

export async function submitAssignment(access: MiniAccess, body: Record<string, any>) {
  const assignmentId = Number(body.assignmentId), operationId = String(body.operationId || "");
  const studentId = access.role === "student" ? Number(access.studentId || 0) : Number(body.studentId || 0);
  if (access.role === "teacher") return Response.json({ error: "教师不能代替学生提交作业" }, { status: 403 });
  const allowedIds = await accessibleStudentIds(access);
  if (!studentId || !allowedIds.includes(studentId)) return Response.json({ error: "无权为该学生提交" }, { status: 403 });
  const assignment = await env.DB.prepare("SELECT a.id,a.status,COALESCE(s.allow_parent_submit,1) AS allowParentSubmit FROM assignments a LEFT JOIN assignment_settings s ON s.assignment_id=a.id WHERE a.id=? AND a.status='published' AND (EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id AND t.target_type='student' AND t.target_id=?) OR (NOT EXISTS(SELECT 1 FROM assignment_targets st WHERE st.assignment_id=a.id AND st.target_type='student') AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id=a.class_id AND e.student_id=? AND e.status='active')))")
    .bind(assignmentId, studentId, studentId).first<Record<string, unknown>>();
  if (!assignment) return Response.json({ error: "作业不存在、未发布或未布置给该学生" }, { status: 404 });
  if (access.role === "parent" && !Boolean(assignment.allowParentSubmit)) return Response.json({ error: "本作业不允许家长代交" }, { status: 403 });
  const actor = { type: "mini_account" as const, id: access.accountId };
  const op = await beginOperation(actor, "submission.finalize", operationId);
  if ("error" in op) return op.error;
  if (!op.acquired) return Response.json(op.result, { status: 200 });
  try {
    let submission = await env.DB.prepare("SELECT id,status FROM assignment_submissions WHERE assignment_id=? AND student_id=?").bind(assignmentId, studentId).first<{ id: number; status: string }>();
    if (!submission) submission = await env.DB.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,'pending') RETURNING id,status").bind(assignmentId, studentId).first<{ id: number; status: string }>();
    if (!submission) throw new Error("无法建立提交记录");
    const assetIds = [...new Set((Array.isArray(body.assetIds) ? body.assetIds : []).map(Number).filter(Boolean))];
    for (const assetId of assetIds) {
      const asset = await env.DB.prepare("SELECT id FROM file_assets WHERE id=? AND owner_type='mini_account' AND owner_id=? AND status='active'").bind(assetId, access.accountId).first();
      if (!asset) throw new Error("附件不存在或不属于当前账号");
    }
    const current = await env.DB.prepare("SELECT COALESCE(MAX(version),0) AS version FROM submission_versions WHERE submission_id=?").bind(submission.id).first<{ version: number }>();
    const version = Number(current?.version || 0) + 1;
    const saved = await env.DB.prepare("INSERT INTO submission_versions(submission_id,version,text_content,status,submitted_by_role) VALUES(?,?,?,?,?) RETURNING id")
      .bind(submission.id, version, String(body.textContent || "").trim() || null, "submitted", access.role).first<{ id: number }>();
    if (!saved) throw new Error("无法保存提交版本");
    for (const [position, assetId] of assetIds.entries()) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO submission_assets(submission_version_id,asset_id,position,precheck_status,precheck_notes) VALUES(?,?,?,?,?)").bind(saved.id, assetId, position, "needs_review", "自动预检仅提供提示，请教师确认清晰度、缺页和错传情况"),
        env.DB.prepare("INSERT INTO file_leases(asset_id,operation_id,state,linked_entity_type,linked_entity_id) VALUES(?,?, 'linked','submission_version',?) ON CONFLICT(asset_id) DO UPDATE SET state='linked',linked_entity_type='submission_version',linked_entity_id=excluded.linked_entity_id,updated_at=CURRENT_TIMESTAMP").bind(assetId, operationId, String(saved.id)),
      ]);
    }
    await env.DB.prepare("UPDATE assignment_submissions SET status='submitted',submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(submission.id).run();
    await recordSyncEvent({ eventType: version === 1 ? "submission.created" : "submission.revised", entityType: "submission", entityId: submission.id, audienceRole: "teacher", studentId, payload: { assignmentId, version } });
    const result = { id: submission.id, version, status: "submitted" };
    await completeOperation(actor, "submission.finalize", operationId, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    await abandonOperation(actor, "submission.finalize", operationId);
    return Response.json({ error: error instanceof Error ? error.message : "提交失败" }, { status: 500 });
  }
}
