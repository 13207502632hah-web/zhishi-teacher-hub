import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("DeepSeek secret remains server-side and client pages only call internal APIs", async () => {
  const server = await read("app/lib/ai/server.ts");
  const clients = (await Promise.all(["app/feedback/page.tsx", "app/questions/page.tsx", "app/settings/page.tsx"].map(read))).join("\n");
  assert.match(server, /env\.DEEPSEEK_API_KEY/);
  assert.match(server, /Authorization: `Bearer/);
  assert.doesNotMatch(clients, /DEEPSEEK_API_KEY|api\.deepseek\.com|Authorization.*Bearer/);
});

test("AI assistance enforces teacher-only, privacy acknowledgement and daily limit", async () => {
  const server = await read("app/lib/ai/server.ts");
  assert.match(server, /access\.role !== "teacher"/);
  assert.match(server, /PRIVACY_ACK_REQUIRED/);
  assert.match(server, /DAILY_LIMIT/);
  assert.match(server, /DEEPSEEK_AI_ENABLED !== "true"/);
});

test("question review keeps sensitive fields out of batch apply and preserves formal review", async () => {
  const apply = await read("app/api/ai/question-reviews/apply/route.ts");
  assert.match(apply, /mode === "single" && ids\.length !== 1/);
  assert.match(apply, /Number\(confidence\[field\] \|\| 0\) < 0\.85/);
  assert.match(apply, /SELECT 1 AS found FROM questions/);
  assert.doesNotMatch(apply, /reviewed\s*=|status='active'/);
  assert.match(apply, /preservesFormalReview: true/);
});

test("migration provides resumable AI runs, feedback learning and question review queue", async () => {
  const migration = await read("drizzle/0026_deepseek_ai_assistance.sql");
  for (const table of ["ai_settings", "ai_runs", "ai_feedback_learning_events", "ai_question_reviews"]) assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  assert.match(migration, /ai_question_review_source_unique/);
  assert.match(migration, /ai_learning_user_fingerprint_unique/);
});

test("feedback learning is recorded on every persisted create or update", async () => {
  const createRoute = await read("app/api/feedback/route.ts"), updateRoute = await read("app/api/feedback/[id]/route.ts"), learning = await read("app/lib/ai/learning.ts");
  assert.match(createRoute, /recordFeedbackLearningEvent/);
  assert.match(updateRoute, /recordFeedbackLearningEvent/);
  assert.match(learning, /redactPrivateText/);
  assert.match(learning, /INSERT OR IGNORE INTO ai_feedback_learning_events/);
});
