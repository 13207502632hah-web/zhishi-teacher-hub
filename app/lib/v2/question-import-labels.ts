import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { abandonOperation, beginOperation, completeOperation } from "../services/idempotency";
import { ensureLocalQuestionVectors } from "./vector-index";

const headers = { "Cache-Control": "no-store" };
const error = (message: string, status = 422) => Response.json({ error: message }, { status, headers });

/** Repair file-label encoding only; preserve question content and independently edited labels. */
export async function correctQuestionImportLabels(access: AccessContext, jobId: string, questionSetId: number, operationId: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return error("请提供原文件标签");
  const raw = input as Record<string, unknown>, keys = ["name", "sourceFile", "expectedName", "expectedSourceFile", "sourceFingerprint"];
  if (Object.keys(raw).some((key) => !keys.includes(key)) || keys.some((key) => typeof raw[key] !== "string" || !String(raw[key]).trim() || String(raw[key]).length > 1000) || !/^[a-f0-9]{64}$/.test(String(raw.sourceFingerprint))) return error("原文件标签或指纹无效");
  const labels = Object.fromEntries(keys.map((key) => [key, String(raw[key])])) as Record<string, string>;
  const inputFingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ questionSetId, labels }))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actor = { type: "user" as const, id: access.id }, action = `question-import.labels:${jobId}`;
  const operation = await beginOperation(actor, action, operationId);
  if ("error" in operation) return operation.error;
  if (!operation.acquired && operation.result.inputFingerprint !== inputFingerprint) return error("操作编号已用于其他内容", 409);
  try {
    const receipt = () => env.DB.prepare("SELECT detail FROM audit_logs WHERE user_id=? AND action='correct_import_labels' AND entity_type='question_set' AND entity_id=? AND json_extract(detail,'$.operationId')=? LIMIT 1")
      .bind(access.id, String(questionSetId), operationId).first<{ detail: string }>();
    const previous = await receipt();
    if (previous && JSON.parse(previous.detail).inputFingerprint !== inputFingerprint) { await abandonOperation(actor, action, operationId); return error("操作编号已用于其他内容", 409); }
    if (!previous) {
      const record = await env.DB.prepare("SELECT id,paper_id AS paperId,name,source_file AS sourceFile,source_fingerprint AS sourceFingerprint FROM question_sets WHERE id=?").bind(questionSetId).first<Record<string, unknown>>();
      if (!record || record.sourceFingerprint !== labels.sourceFingerprint || record.name !== labels.expectedName || record.sourceFile !== labels.expectedSourceFile) { await abandonOperation(actor, action, operationId); return error("试卷名称、来源或文件已变更，未覆盖", 409); }
      const detail = JSON.stringify({ jobId, operationId, inputFingerprint, before: record, name: labels.name, sourceFile: labels.sourceFile });
      const guard = "EXISTS(SELECT 1 FROM audit_logs WHERE user_id=? AND action='correct_import_labels' AND entity_type='question_set' AND entity_id=? AND json_extract(detail,'$.operationId')=?)";
      const guardValues = [access.id, String(questionSetId), operationId];
      await env.DB.batch([
        env.DB.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) SELECT ?,'correct_import_labels','question_set',id,? FROM question_sets WHERE id=? AND name=? AND source_file=? AND source_fingerprint=?")
          .bind(access.id, detail, questionSetId, labels.expectedName, labels.expectedSourceFile, labels.sourceFingerprint),
        env.DB.prepare(`UPDATE question_sets SET name=?,source_file=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${guard}`)
          .bind(labels.name, labels.sourceFile, questionSetId, ...guardValues),
        env.DB.prepare(`UPDATE questions SET source=CASE WHEN source=? THEN ? ELSE source END,source_file=CASE WHEN source_file=? THEN ? ELSE source_file END,updated_at=CURRENT_TIMESTAMP WHERE question_set_id=? AND (source=? OR source_file=?) AND ${guard}`)
          .bind(labels.expectedSourceFile, labels.sourceFile, labels.expectedSourceFile, labels.sourceFile, questionSetId, labels.expectedSourceFile, labels.expectedSourceFile, ...guardValues),
        env.DB.prepare(`UPDATE papers SET title=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND title=? AND ${guard}`)
          .bind(labels.name, record.paperId, labels.expectedName, ...guardValues),
      ]);
      if (!await receipt()) { await abandonOperation(actor, action, operationId); return error("试卷标签被并发修改，未覆盖", 409); }
    }
    const result = { questionSetId, name: labels.name, sourceFile: labels.sourceFile, inputFingerprint };
    await completeOperation(actor, action, operationId, result);
    const rows = await env.DB.prepare("SELECT id,stem,material,stage,grade,knowledge_points AS knowledgePoints,source FROM questions WHERE question_set_id=?").bind(questionSetId).all<Record<string, unknown>>();
    await ensureLocalQuestionVectors(rows.results.map((row) => ({ id: Number(row.id), text: [row.stem, row.material, row.stage, row.grade, row.knowledgePoints, row.source].filter(Boolean).join("\n") })));
    return Response.json({ ...result, repeated: Boolean(previous) }, { headers });
  } catch (reason) { await abandonOperation(actor, action, operationId); throw reason; }
}
