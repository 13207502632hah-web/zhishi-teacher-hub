import { eq, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../../db";
import { questions, questionSets } from "../../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { questionReadinessIssues } from "../../../../lib/question-readiness";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("questions:write"); if (isDenied(access)) return access;
  const id = Number((await context.params).id), db = getDb(), [set] = await db.select().from(questionSets).where(eq(questionSets.id, id)).limit(1);
  if (!set) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  const all = await db.select().from(questions).where(eq(questions.questionSetId, id));
  const fingerprints = all.map((item) => item.fingerprint).filter(Boolean) as string[], duplicateIds = new Set<number>();
  if (fingerprints.length) { const marks = fingerprints.map(() => "?").join(","), duplicates = await env.DB.prepare(`SELECT id FROM questions WHERE fingerprint IN (${marks}) AND fingerprint IN (SELECT fingerprint FROM questions WHERE fingerprint IN (${marks}) GROUP BY fingerprint HAVING COUNT(*)>1)`).bind(...fingerprints, ...fingerprints).all<{ id: number }>(); duplicates.results.forEach((item) => duplicateIds.add(item.id)); }
  const reviewed = all.filter((item) => item.reviewed), blocked = reviewed.map((item) => ({ id: item.id, issues: questionReadinessIssues(item, { requireReviewed: true, duplicate: duplicateIds.has(item.id) }) })).filter((item) => item.issues.length), blockedIds = new Set(blocked.map((item) => item.id)), readyIds = reviewed.filter((item) => !blockedIds.has(item.id)).map((item) => item.id);
  if (readyIds.length) await db.update(questions).set({ status: "active", reviewStatus: "confirmed", updatedAt: new Date().toISOString() }).where(inArray(questions.id, readyIds));
  const remaining = all.length - readyIds.length, completed = remaining === 0;
  await db.update(questionSets).set({ status: completed ? "active" : "review", parseStage: completed ? "completed" : "review", reviewProgress: readyIds.length, updatedAt: new Date().toISOString() }).where(eq(questionSets.id, id));
  await audit(access, "confirm", "question_set", id, { status: completed ? "active" : "partial", promoted: readyIds.length, blocked: blocked.length, unreviewed: all.length - reviewed.length });
  if (!readyIds.length) return Response.json({ error: "当前没有满足正式入库条件的已校对题目", blocked, report: { total: all.length, ready: 0, blocked: blocked.length, unreviewed: all.length - reviewed.length } }, { status: 409 });
  return Response.json({ ok: true, partial: !completed, promoted: readyIds.length, blocked, report: { total: all.length, ready: readyIds.length, blocked: blocked.length, unreviewed: all.length - reviewed.length } });
}
