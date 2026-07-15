import { env } from "cloudflare:workers";
import { questionReadinessIssues } from "../question-readiness";

type ReviewAction = "confirm" | "return" | "ignore";
type ReviewRow = Record<string, unknown> & { id: number; question_set_id?: number | null; updated_at?: string | null; fingerprint?: string | null };

export type QuestionReviewResult = {
  ok: boolean;
  action: ReviewAction;
  updated: number;
  blocked: Array<{ id: number; issues: string[] }>;
  stale?: Array<{ id: number; updatedAt: string | null }>;
  setIds: number[];
};

export async function reviewQuestions(idsInput: number[], action: ReviewAction, options: { requireReviewed?: boolean; expectedUpdatedAt?: string } = {}): Promise<QuestionReviewResult> {
  const ids = [...new Set(idsInput.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 300);
  if (!ids.length) return { ok: false, action, updated: 0, blocked: [], setIds: [] };
  const marks = ids.map(() => "?").join(",");
  const rows = (await env.DB.prepare(`SELECT * FROM questions WHERE id IN (${marks})`).bind(...ids).all<ReviewRow>()).results;
  if (options.expectedUpdatedAt) {
    const stale = rows.filter((row) => String(row.updated_at || "") !== options.expectedUpdatedAt).map((row) => ({ id: row.id, updatedAt: row.updated_at || null }));
    if (stale.length) return { ok: false, action, updated: 0, blocked: [], stale, setIds: [] };
  }
  const setIds = [...new Set(rows.map((row) => Number(row.question_set_id || 0)).filter(Boolean))];
  let blocked: Array<{ id: number; issues: string[] }> = [];
  if (action === "confirm") {
    const fingerprints = rows.map((row) => String(row.fingerprint || "")).filter(Boolean), duplicateIds = new Set<number>();
    if (fingerprints.length) {
      const fingerprintMarks = fingerprints.map(() => "?").join(",");
      const duplicates = await env.DB.prepare(`SELECT id FROM questions WHERE fingerprint IN (${fingerprintMarks}) AND fingerprint IN (SELECT fingerprint FROM questions WHERE fingerprint IN (${fingerprintMarks}) GROUP BY fingerprint HAVING COUNT(*)>1)`).bind(...fingerprints, ...fingerprints).all<{ id: number }>();
      duplicates.results.forEach((row) => duplicateIds.add(Number(row.id)));
    }
    blocked = rows.map((row) => ({ id: row.id, issues: questionReadinessIssues(row, { requireReviewed: options.requireReviewed, duplicate: duplicateIds.has(row.id) }) })).filter((row) => row.issues.length);
  }
  const blockedIds = new Set(blocked.map((row) => row.id)), readyIds = rows.map((row) => row.id).filter((id) => !blockedIds.has(id));
  if (!readyIds.length) return { ok: false, action, updated: 0, blocked, setIds };
  const readyMarks = readyIds.map(() => "?").join(","), statements = [];
  if (action === "confirm") statements.push(env.DB.prepare(`UPDATE questions SET status='active',reviewed=1,review_status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id IN (${readyMarks})`).bind(...readyIds));
  if (action === "return") statements.push(env.DB.prepare(`UPDATE questions SET status='review',reviewed=0,review_status='returned',updated_at=CURRENT_TIMESTAMP WHERE id IN (${readyMarks})`).bind(...readyIds));
  if (action === "ignore") statements.push(env.DB.prepare(`UPDATE questions SET status='review',review_status='ignored',updated_at=CURRENT_TIMESTAMP WHERE id IN (${readyMarks})`).bind(...readyIds));
  for (const setId of setIds) statements.push(env.DB.prepare("UPDATE question_sets SET review_progress=(SELECT COUNT(*) FROM questions WHERE question_set_id=? AND status='active'),status=CASE WHEN EXISTS(SELECT 1 FROM questions WHERE question_set_id=? AND status='review') THEN 'review' ELSE 'active' END,parse_stage=CASE WHEN EXISTS(SELECT 1 FROM questions WHERE question_set_id=? AND status='review') THEN 'review' ELSE 'completed' END,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(setId, setId, setId, setId));
  await env.DB.batch(statements);
  return { ok: true, action, updated: readyIds.length, blocked, setIds };
}
