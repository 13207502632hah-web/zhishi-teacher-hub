import { env } from "cloudflare:workers";
import { beginOperation, completeOperation, abandonOperation, type OperationActor } from "./idempotency";
import { recordSyncEvent } from "./mini-sync-service";

const outcomes = new Set(["excellent", "completed", "revision", "incomplete"]);

export async function saveReview(input: Record<string, any>, reviewer: { actor: OperationActor; userId: number | null }) {
  const submissionId = Number(input.submissionId), confirm = input.action === "confirm-review";
  if (!submissionId || !outcomes.has(String(input.outcome || input.status))) return Response.json({ error: "批改对象或状态不正确" }, { status: 400 });
  const outcome = String(input.outcome || input.status), operationId = String(input.operationId || "");
  if (confirm) {
    const op = await beginOperation(reviewer.actor, "review.confirm", operationId);
    if ("error" in op) return op.error;
    if (!op.acquired) return Response.json(op.result, { status: 200 });
  }
  try {
    const submission = await env.DB.prepare("SELECT s.id,s.student_id AS studentId,s.assignment_id AS assignmentId,a.lesson_id AS lessonId,(SELECT id FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS versionId FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?")
      .bind(submissionId).first<Record<string, unknown>>();
    if (!submission) throw new Error("提交记录不存在");
    const tags = Array.isArray(input.reviewTags) ? input.reviewTags.join("、") : String(input.reviewTags || "");
    const row = await env.DB.prepare("INSERT INTO submission_reviews(submission_id,submission_version_id,status,outcome,score,review_tags,teacher_note,revision_requirements,operation_id,reviewed_by,confirmed_at) VALUES(?,?,?, ?,?,?,?,?,?,?,CASE WHEN ?='confirmed' THEN CURRENT_TIMESTAMP ELSE NULL END) RETURNING id")
      .bind(submissionId, submission.versionId || null, confirm ? "confirmed" : "draft", outcome, input.score ?? null, tags || null, String(input.teacherNote || "").trim() || null, String(input.revisionRequirements || "").trim() || null, operationId || null, reviewer.userId, confirm ? "confirmed" : "draft").first<{ id: number }>();
    const assetIds = [...new Set((Array.isArray(input.reviewAssetIds) ? input.reviewAssetIds : []).map(Number).filter(Boolean))];
    for (const [position, assetId] of assetIds.entries()) {
      const asset = await env.DB.prepare("SELECT id,mime_type AS mimeType FROM file_assets WHERE id=? AND owner_type='mini_account' AND owner_id=? AND status='active'").bind(assetId, reviewer.actor.id).first<Record<string, unknown>>();
      if (!asset) throw new Error("批改附件不存在或不属于当前教师账号");
      const type = String(asset.mimeType || "").startsWith("audio/") ? "voice" : "annotation";
      await env.DB.batch([
        env.DB.prepare("INSERT INTO review_assets(review_id,asset_id,type,position) VALUES(?,?,?,?)").bind(row?.id, assetId, type, position),
        env.DB.prepare("INSERT INTO file_leases(asset_id,state,linked_entity_type,linked_entity_id) VALUES(?,'linked','submission_review',?) ON CONFLICT(asset_id) DO UPDATE SET state='linked',linked_entity_type='submission_review',linked_entity_id=excluded.linked_entity_id,updated_at=CURRENT_TIMESTAMP").bind(assetId, String(row?.id || "")),
      ]);
    }
    if (confirm) {
      await env.DB.prepare("UPDATE assignment_submissions SET status=?,score=?,review_tags=?,teacher_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(outcome, input.score ?? null, tags || null, String(input.teacherNote || "").trim() || null, submissionId).run();
      await recordSyncEvent({ eventType: outcome === "revision" ? "review.revision_required" : "review.confirmed", entityType: "submission", entityId: submissionId, studentId: Number(submission.studentId), payload: { assignmentId: submission.assignmentId, outcome, score: input.score ?? null, reviewTags: Array.isArray(input.reviewTags) ? input.reviewTags : [] } });
      for (const result of Array.isArray(input.questionResults) ? input.questionResults : []) {
        const knowledge = Array.isArray(result.knowledgePoints) ? result.knowledgePoints : String(result.knowledgePoints || "").split(/[、,，]/).filter(Boolean);
        for (const name of knowledge) await env.DB.prepare("INSERT INTO knowledge_evidence(student_id,knowledge_name,level,source_type,source_id,evidence,is_manual,created_by) VALUES(?,?,?,'assignment_review',?,?,0,?)")
          .bind(submission.studentId, String(name), Number(result.score || 0) >= Number(result.maxScore || 1) * .8 ? "熟练" : "待巩固", row?.id || null, JSON.stringify({ questionId: result.questionId || null, score: result.score ?? null, maxScore: result.maxScore ?? null, confirmed: true }), reviewer.userId).run();
        if (result.questionId && Number(result.score || 0) < Number(result.maxScore || 1)) await env.DB.prepare("INSERT OR IGNORE INTO wrong_questions(student_id,question_id,lesson_id,incorrect_answer,reason,status) VALUES(?,?,?,?,?,'active')")
          .bind(submission.studentId, Number(result.questionId), submission.lessonId || null, String(result.answer || "") || null, String(result.errorType || "教师确认的作业错题")).run();
      }
      const result = { ok: true, id: row?.id, status: outcome };
      await completeOperation(reviewer.actor, "review.confirm", operationId, result);
      return Response.json(result);
    }
    return Response.json({ ok: true, id: row?.id, status: "draft" }, { status: 201 });
  } catch (error) {
    if (confirm) await abandonOperation(reviewer.actor, "review.confirm", operationId);
    return Response.json({ error: error instanceof Error ? error.message : "保存批改失败" }, { status: 500 });
  }
}
