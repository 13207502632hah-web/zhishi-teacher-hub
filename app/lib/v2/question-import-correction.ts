import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { questionFingerprint } from "../question-fingerprint";
import { abandonOperation, beginOperation, completeOperation } from "../services/idempotency";
import { ensureLocalQuestionVectors } from "./vector-index";

const columns: Record<string, string> = {
  stem: "stem", material: "material", options: "options", answer: "answer", answerPoints: "answer_points",
  analysis: "analysis", knowledgePoints: "knowledge_points", stage: "stage", grade: "grade", score: "score", year: "year", region: "region", notes: "notes",
};
type Correction = { id: number; expectedUpdatedAt: string; changes: Record<string, string | number>; sourcePages: number[] };
const noStore = { "Cache-Control": "no-store" };
const error = (message: string, status = 422) => Response.json({ error: message }, { status, headers: noStore });

/** Correct an untouched automatic import, never an edited/teacher-reviewed question. */
export async function correctQuestionImport(access: AccessContext, jobId: string, questionSetId: number, operationId: string, input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100) return error("每次须提供 1 至 100 道原卷修正");
  const corrections: Correction[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return error("修正格式不正确");
    const item = raw as Record<string, unknown>, changes = item.changes as Record<string, unknown>;
    if (!Number.isInteger(item.id) || Number(item.id) <= 0 || typeof item.expectedUpdatedAt !== "string" || !item.expectedUpdatedAt || !changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) return error("修正必须指定原题、原版本和修改字段");
    for (const [key, value] of Object.entries(changes)) {
      if (!columns[key] || !["string", "number"].includes(typeof value)) return error("包含不允许修改的字段");
      if (typeof value === "string" && value.length > 60_000) return error("字段内容过长");
      if (["score", "year"].includes(key) && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) return error("分值或年份格式不正确");
    }
    if (!Array.isArray(item.sourcePages) || !item.sourcePages.length || item.sourcePages.some((page) => !Number.isInteger(page) || page < 1 || page > 60)) return error("必须记录核对依据的原卷页码");
    corrections.push({ id: Number(item.id), expectedUpdatedAt: item.expectedUpdatedAt, changes: changes as Correction["changes"], sourcePages: item.sourcePages });
  }
  if (new Set(corrections.map((item) => item.id)).size !== corrections.length) return error("同一题不能重复修正");
  const inputFingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ questionSetId, corrections }))))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const actor = { type: "user" as const, id: access.id }, action = `question-import.correct:${jobId}`;
  const operation = await beginOperation(actor, action, operationId);
  if ("error" in operation) return operation.error;
  if (!operation.acquired && operation.result.inputFingerprint !== inputFingerprint) return error("操作编号已被其他修正内容使用", 409);
  try {
    const readReceipts = () => env.DB.prepare("SELECT entity_id AS id,detail FROM audit_logs WHERE user_id=? AND action='correct_import' AND entity_type='question' AND json_extract(detail,'$.jobId')=? AND json_extract(detail,'$.operationId')=?")
      .bind(access.id, jobId, operationId).all<{ id: number; detail: string }>();
    const finish = async (repeated: boolean) => {
      // D1's changed-row count includes FTS trigger writes; use per-question receipts.
      const receipts = await readReceipts(), updated = [...new Set(receipts.results.map((row) => Number(row.id)))];
      const rows = await env.DB.prepare("SELECT id,stem,material,stage,grade,knowledge_points AS knowledgePoints FROM questions WHERE question_set_id=? AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))")
        .bind(questionSetId, JSON.stringify(updated)).all<Record<string, unknown>>();
      const result = { updated, conflicts: corrections.filter((item) => !updated.includes(item.id)).map((item) => item.id), inputFingerprint };
      // Persist the content-write receipt before indexing so a retry can finish indexing
      // without attempting to overwrite an already-corrected question.
      await completeOperation(actor, action, operationId, result);
      await ensureLocalQuestionVectors(rows.results.map((row) => ({ id: Number(row.id), text: [row.stem, row.material, row.stage, row.grade, row.knowledgePoints].filter(Boolean).join("\n") })));
      return Response.json({ ...result, ...(repeated ? { repeated: true } : {}) }, { headers: noStore });
    };
    const recorded = await readReceipts();
    if (recorded.results.length) {
      const matches = recorded.results.every((row) => {
        const detail = JSON.parse(row.detail), requested = corrections.find((item) => item.id === Number(row.id));
        return requested && requested.expectedUpdatedAt === detail.before.updatedAt && JSON.stringify(requested.changes) === JSON.stringify(detail.changes) && JSON.stringify(requested.sourcePages) === JSON.stringify(detail.sourcePages);
      });
      if (!matches) { await abandonOperation(actor, action, operationId); return error("操作编号已被其他修正内容使用", 409); }
    }
    if (!operation.acquired || recorded.results.length) return await finish(true);
    const prepared = [];
    for (const item of corrections) {
      const before = await env.DB.prepare(`SELECT id,${Object.entries(columns).map(([key, column]) => `${column} AS ${key}`).join(",")},created_at AS createdAt,updated_at AS updatedAt,reviewed,review_status AS reviewStatus FROM questions WHERE id=? AND question_set_id=?`).bind(item.id, questionSetId).first<Record<string, unknown>>();
      if (!before || before.updatedAt !== item.expectedUpdatedAt || before.createdAt !== before.updatedAt || before.reviewed || before.reviewStatus !== "auto_checked") {
        await abandonOperation(actor, action, operationId);
        return error(`第 ${item.id} 题已被修改、确认或不属于本次导入，未覆盖`, 409);
      }
      const after = { ...before, ...item.changes };
      if (!String(after.stem || "").trim()) { await abandonOperation(actor, action, operationId); return error("修正后的题干不能为空"); }
      const originalNumber = String(before.notes || "").match(/^原题号：\d+/m)?.[0];
      if (originalNumber && !String(after.notes || "").split("\n").includes(originalNumber)) { await abandonOperation(actor, action, operationId); return error("修正不能改变原题号"); }
      const fingerprint = questionFingerprint(after);
      const duplicate = await env.DB.prepare("SELECT id FROM questions WHERE fingerprint=? AND id!=? LIMIT 1").bind(fingerprint, item.id).first();
      if (duplicate) { await abandonOperation(actor, action, operationId); return error("修正后与其他题目重复，未覆盖", 409); }
      prepared.push({ item, before, after, fingerprint });
    }
    const updatedAt = new Date().toISOString(), statements: D1PreparedStatement[] = [];
    for (const { item, before, after, fingerprint } of prepared) {
      const entries = Object.entries(item.changes);
      statements.push(env.DB.prepare(`UPDATE questions SET ${entries.map(([key]) => `${columns[key]}=?`).join(",")},fingerprint=?,updated_at=? WHERE id=? AND question_set_id=? AND updated_at=? AND created_at=updated_at AND reviewed=0 AND review_status='auto_checked'`)
        .bind(...entries.map(([, value]) => value), fingerprint, updatedAt, item.id, questionSetId, item.expectedUpdatedAt));
      statements.push(env.DB.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) SELECT ?,'correct_import','question',id,? FROM questions WHERE id=? AND question_set_id=? AND updated_at=?")
        .bind(access.id, JSON.stringify({ jobId, operationId, sourcePages: item.sourcePages, before, changes: item.changes, after: { ...after, updatedAt } }), item.id, questionSetId, updatedAt));
    }
    await env.DB.batch(statements);
    return await finish(false);
  } catch (reason) {
    await abandonOperation(actor, action, operationId);
    throw reason;
  }
}
