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

test("website creates assignments while mini only reads the shared assignment service", async () => {
  const [website, mini, service, page, navigation] = await Promise.all(["app/api/assignments/route.ts", "app/api/v2/mini/assignments/route.ts", "app/lib/services/assignment-service.ts", "app/assignments/page.tsx", "app/components/navigation.ts"].map(read));
  assert.match(website, /createAssignment/); assert.match(mini, /listAssignments/); assert.doesNotMatch(mini, /createAssignment|export async function POST/);
  assert.match(service, /assignment_targets/); assert.match(service, /studentIds/); assert.match(service, /idempotency/);
  for (const label of ["作业中心", "指定学生", "保存批改草稿", "确认批改并回传"]) assert.match(page, new RegExp(label));
  assert.match(navigation, /href: "\/assignments"/);
});

test("binding is two-step and disabled links are rechecked server-side", async () => {
  const [binding, settings, me, auth] = await Promise.all(["app/lib/services/mini-binding-service.ts", "app/mini-settings/page.tsx", "app/api/v2/mini/me/route.ts", "app/lib/mini-auth.ts"].map(read));
  assert.match(binding, /status='pending'/); assert.match(binding, /decision === "confirm"/); assert.match(binding, /status='disabled'/);
  assert.match(settings, /一期仅服务学生与家长/); assert.match(settings, /教师确认学生或家长绑定/); assert.match(settings, /停用后旧会话/); assert.match(me, /miniAccountState/);
  assert.doesNotMatch(settings + auth, /关联小程序教师端|linkTeacher|教师小程序账号/);
});

test("submission finalize and review confirmation are idempotent and keep versions", async () => {
  const [submission, review, operation] = await Promise.all(["app/lib/services/submission-service.ts", "app/lib/services/review-service.ts", "app/lib/services/idempotency.ts"].map(read));
  assert.match(submission, /submission\.finalize/); assert.match(submission, /MAX\(version\)/); assert.match(submission, /submission_versions/); assert.match(submission, /file_leases/);
  assert.match(review, /review\.confirm/); assert.match(review, /status: "draft"/); assert.match(review, /knowledge_evidence/); assert.match(review, /wrong_questions/);
  assert.match(operation, /INSERT OR IGNORE INTO idempotency_operations/); assert.match(operation, /result_json/);
});

test("incremental sync uses server cursor and never exposes broad events to student or parent", async () => {
  const [sync, route] = await Promise.all([read("app/lib/services/mini-sync-service.ts"), read("app/api/v2/mini/sync/route.ts")]);
  assert.match(sync, /WHERE id>\?/); assert.match(sync, /student_id IN/); assert.doesNotMatch(sync, /access\.role === "teacher"/);
  assert.doesNotMatch(sync, /clauses = \["account_id=\?", "audience_role=\?", "audience_role IS NULL"\]/);
  assert.match(route, /full: true/); assert.match(route, /snapshot/);
});

test("private assignment and paper files enforce target-aware access and no-store headers", async () => {
  const [files, papers, excellent] = await Promise.all(["app/api/v2/mini/files/[id]/route.ts", "app/api/v2/mini/paper-files/[id]/route.ts", "app/api/v2/mini/excellent/route.ts"].map(read));
  for (const source of [files, papers]) { assert.match(source, /assignment_targets/); assert.match(source, /private, no-store/); assert.match(source, /nosniff/); }
  assert.match(excellent, /masking_status='confirmed'/); assert.doesNotMatch(excellent, /export async function POST|maskedAssetId/);
});

test("mini client contains only student and parent pages, session expiry and recoverable drafts", async () => {
  const [config, api, app, home, submit, readme] = await Promise.all(["mini-program/config.js", "mini-program/utils/api.js", "mini-program/app.json", "mini-program/pages/home/index.wxml", "mini-program/pages/submit/index.js", "mini-program/README.md"].map(read));
  assert.match(config, /develop/); assert.match(config, /trial/); assert.match(config, /release/); assert.match(config, /testLoginEnabled/);
  assert.match(api, /MINI_SESSION_EXPIRED|statusCode === 401/); assert.match(api, /onProgressUpdate/); assert.match(api, /mini-sync-cursor/);
  for (const page of ["pages/bind/index", "pages/portal/index", "pages/dictation/index", "pages/class-files/index", "pages/notices/index", "pages/assignment/index", "pages/submit/index"]) assert.match(app, new RegExp(page));
  for (const teacherOnlyPage of ["pages/review/index", "pages/publish/index", "pages/inbox/index", "pages/annotate/index"]) assert.doesNotMatch(app, new RegExp(teacherOnlyPage));
  assert.match(api, /\/api\/v2\/mini/);
  assert.doesNotMatch(api, /v2Path|\/api\/mini/);
  assert.match(home, /showTestLogin/); assert.match(home, /重新微信登录/); assert.match(home, /微信账号编号/); assert.match(submit, /submission-draft-/); assert.match(submit, /operationId/);
  assert.doesNotMatch(home, /教师端|测试教师/);
  for (const page of ["review", "publish", "inbox", "annotate"]) await assert.rejects(read(`mini-program/pages/${page}/index.js`), { code: "ENOENT" });
  assert.match(readme, /不是已经提交审核或正式发布/);
});

test("formal login fails safely and production gate rejects all mini entry points", async () => {
  const [login, auth] = await Promise.all([read("app/api/v2/mini/login/route.ts"), read("app/lib/mini-auth.ts")]);
  assert.match(login, /WECHAT_APP_ID/); assert.match(login, /WECHAT_APP_SECRET/); assert.match(login, /CF_PAGES_ENV !== "production"/); assert.match(login, /当前环境禁止测试登录/);
  assert.match(login, /if \(miniProductionDisabled\(\)\) return miniDisabledResponse\(\);/);
  assert.match(login, /miniDisabledResponse/);
  assert.match(auth, /if \(miniProductionDisabled\(\)\) return miniDisabledResponse\(\);/);
  assert.match(auth, /MINI_FEATURE_DISABLED/);
  assert.match(login, /WECHAT_LOGIN_FAILED/);
  assert.match(login, /providerCode/);
  assert.doesNotMatch(login, /errmsg/);
  assert.doesNotMatch(login, /console\.log|AppSecret/);
  assert.match(login, /小程序一期只支持学生和家长/); assert.match(auth, /role: "student" \| "parent"/);
  for (const route of ["accounts", "classes"]) await assert.rejects(read(`app/api/v2/mini/${route}/route.ts`), { code: "ENOENT" });
});
