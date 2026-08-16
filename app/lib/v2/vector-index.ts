import { env } from "cloudflare:workers";
import { localSemanticVector } from "./ai-router";

type VectorSource = { id: number; text: string };
const encoder = new TextEncoder();
const fingerprint = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function ensureLocalQuestionVectors(input: VectorSource[]) {
  if (!input.length) return new Map<number, number[]>();
  const unique = [...new Map(input.map((item) => [Number(item.id), item])).values()].filter((item) => Number.isInteger(item.id) && item.id > 0), marks = unique.map(() => "?").join(",");
  const stored = await env.DB.prepare(`SELECT question_id AS questionId,vector_json AS vectorJson,text_fingerprint AS textFingerprint FROM v2_question_vectors WHERE question_id IN (${marks}) AND model='local-char-ngram-v1'`).bind(...unique.map((item) => item.id)).all<{ questionId: number; vectorJson: string; textFingerprint: string }>();
  const existing = new Map(stored.results.map((row) => [Number(row.questionId), row])), output = new Map<number, number[]>(), writes: D1PreparedStatement[] = [];
  for (const item of unique) {
    const hash = await fingerprint(item.text), cached = existing.get(item.id); let vector: number[] | null = null;
    if (cached?.textFingerprint === hash) { try { const parsed = JSON.parse(cached.vectorJson); if (Array.isArray(parsed)) vector = parsed.map(Number); } catch { /* 重建损坏的本地向量。 */ } }
    if (!vector) { vector = localSemanticVector(item.text); writes.push(env.DB.prepare("INSERT INTO v2_question_vectors(question_id,model,dimensions,vector_json,text_fingerprint) VALUES(?,'local-char-ngram-v1',?,?,?) ON CONFLICT(question_id) DO UPDATE SET model=excluded.model,dimensions=excluded.dimensions,vector_json=excluded.vector_json,text_fingerprint=excluded.text_fingerprint,updated_at=CURRENT_TIMESTAMP").bind(item.id, vector.length, JSON.stringify(vector), hash)); }
    output.set(item.id, vector);
  }
  for (let index = 0; index < writes.length; index += 50) await env.DB.batch(writes.slice(index, index + 50));
  return output;
}
