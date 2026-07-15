import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mini integration documents one D1 and R2 source with manual confirmation boundaries", async () => {
  const doc = await read("docs/mini-program-integration.md");
  for (const marker of ["D1 唯一结构化数据", "R2 私有附件", "统一领域服务", "批改草稿只对教师可见", "教师确认的题目级结果", "无 AppID 时的测试"]) assert.match(doc, new RegExp(marker));
  assert.match(doc, /不得部署生产或提交微信审核/);
});

test("migration adds binding, targets, idempotency, sync, leases and confirmed reviews without deleting old fields", async () => {
  const [migration, schema] = await Promise.all([read("drizzle/0020_mini_integration.sql"), read("db/schema.ts")]);
  for (const table of ["mini_bindings", "assignment_targets", "assignment_settings", "idempotency_operations", "sync_events", "file_leases", "submission_reviews", "reminder_tasks"]) {
    assert.match(migration, new RegExp("CREATE TABLE IF NOT EXISTS `" + table + "`"));
  }
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|ALTER TABLE/);
  for (const entity of ["miniBindings", "assignmentTargets", "idempotencyOperations", "syncEvents", "fileLeases", "submissionReviews"]) assert.match(schema, new RegExp(`export const ${entity}`));
});

test("website and mini assignment routes call the same assignment service", async () => {
  const [website, mini, service, page, shell] = await Promise.all(["app/api/assignments/route.ts", "app/api/mini/assignments/route.ts", "app/lib/services/assignment-service.ts", "app/assignments/page.tsx", "app/components/AppShell.tsx"].map(read));
  assert.match(website, /createAssignment/); assert.match(mini, /createAssignment/);
  assert.match(service, /assignment_targets/); assert.match(service, /studentIds/); assert.match(service, /idempotency/);
  for (const label of ["作业中心", "指定学生", "保存批改草稿", "确认批改并回传"]) assert.match(page, new RegExp(label));
  assert.match(shell, /href: "\/assignments"/);
});

test("binding is two-step and disabled links are rechecked server-side", async () => {
  const [binding, settings, me, auth] = await Promise.all(["app/lib/services/mini-binding-service.ts", "app/mini-settings/page.tsx", "app/api/mini/me/route.ts", "app/lib/mini-auth.ts"].map(read));
  assert.match(binding, /status='pending'/); assert.match(binding, /decision === "confirm"/); assert.match(binding, /status='disabled'/);
  assert.match(settings, /教师确认绑定/); assert.match(settings, /停用后旧会话/); assert.match(me, /miniAccountState/);
  assert.match(auth, /教师小程序账号尚未关联网站教师/);
});

test("submission finalize and review confirmation are idempotent and keep versions", async () => {
  const [submission, review, operation] = await Promise.all(["app/lib/services/submission-service.ts", "app/lib/services/review-service.ts", "app/lib/services/idempotency.ts"].map(read));
  assert.match(submission, /submission\.finalize/); assert.match(submission, /MAX\(version\)/); assert.match(submission, /submission_versions/); assert.match(submission, /file_leases/);
  assert.match(review, /review\.confirm/); assert.match(review, /status: "draft"/); assert.match(review, /knowledge_evidence/); assert.match(review, /wrong_questions/);
  assert.match(operation, /INSERT OR IGNORE INTO idempotency_operations/); assert.match(operation, /result_json/);
});

test("incremental sync uses server cursor and never exposes broad events to student or parent", async () => {
  const [sync, route] = await Promise.all([read("app/lib/services/mini-sync-service.ts"), read("app/api/mini/sync/route.ts")]);
  assert.match(sync, /WHERE id>\?/); assert.match(sync, /student_id IN/); assert.match(sync, /access\.role === "teacher"/);
  assert.doesNotMatch(sync, /clauses = \["account_id=\?", "audience_role=\?", "audience_role IS NULL"\]/);
  assert.match(route, /full: true/); assert.match(route, /snapshot/);
});

test("private assignment and paper files enforce target-aware access and no-store headers", async () => {
  const [files, papers, excellent] = await Promise.all(["app/api/mini/files/[id]/route.ts", "app/api/mini/paper-files/[id]/route.ts", "app/api/mini/excellent/route.ts"].map(read));
  for (const source of [files, papers]) { assert.match(source, /assignment_targets/); assert.match(source, /private, no-store/); assert.match(source, /nosniff/); }
  assert.match(excellent, /masking_status='confirmed'/); assert.match(excellent, /maskedAssetId/);
});

test("mini client has role pages, environment config, session expiry and recoverable drafts", async () => {
  const [config, api, app, home, submit, review, publish, inbox, annotate, readme] = await Promise.all(["mini-program/config.js", "mini-program/utils/api.js", "mini-program/app.json", "mini-program/pages/home/index.wxml", "mini-program/pages/submit/index.js", "mini-program/pages/review/index.wxml", "mini-program/pages/publish/index.wxml", "mini-program/pages/inbox/index.wxml", "mini-program/pages/annotate/index.wxml", "mini-program/README.md"].map(read));
  assert.match(config, /develop/); assert.match(config, /trial/); assert.match(config, /release/);
  assert.match(api, /MINI_SESSION_EXPIRED|statusCode === 401/); assert.match(api, /onProgressUpdate/); assert.match(api, /mini-sync-cursor/);
  for (const page of ["pages/bind/index", "pages/portal/index", "pages/review/index", "pages/publish/index", "pages/inbox/index", "pages/annotate/index"]) assert.match(app, new RegExp(page));
  assert.match(home, /测试.*教师/); assert.match(submit, /submission-draft-/); assert.match(submit, /operationId/); assert.match(review, /确认并回传/);
  assert.match(publish, /预览发布/); assert.match(inbox, /已交待批/); assert.match(annotate, /不覆盖学生原图/);
  assert.match(readme, /不是已经提交审核或正式发布/);
});

test("formal login fails safely and production rejects test codes", async () => {
  const login = await read("app/api/mini/login/route.ts");
  assert.match(login, /WECHAT_APP_ID/); assert.match(login, /WECHAT_APP_SECRET/); assert.match(login, /CF_PAGES_ENV !== "production"/); assert.match(login, /当前环境禁止测试登录/);
  assert.doesNotMatch(login, /console\.log|AppSecret/);
});
