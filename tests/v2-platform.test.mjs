import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("V2 migration adds resumable jobs, approvals, imports, vectors, audit evidence and FTS", async () => {
  const migration = await read("drizzle/0029_zhishi_v2_platform.sql");
  for (const table of ["v2_jobs", "v2_job_events", "v2_approvals", "v2_idempotency_operations", "v2_ai_runs", "v2_schedule_imports", "v2_schedule_rows", "v2_question_vectors", "v2_search_events", "v2_questions_fts"]) assert.match(migration, new RegExp(table));
  for (const state of ["queued", "running", "waiting_review", "completed", "partial", "failed", "cancelled"]) assert.match(await read("app/lib/v2/contracts.ts"), new RegExp(state));
  assert.match(migration, /tokenize='trigram'/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS `v2_questions_fts_update`/);
});

test("multi-model AI routing anonymizes identities, validates JSON and records provenance", async () => {
  const [router, privacy, assistant] = await Promise.all([read("app/lib/v2/ai-router.ts"), read("app/lib/v2/privacy.ts"), read("app/api/v2/assistant/runs/route.ts")]);
  for (const capability of ["fast", "reasoning", "vision", "embedding", "rerank"]) assert.match(router, new RegExp(capability));
  assert.match(router, /v2_ai_runs/); assert.match(router, /promptVersion/); assert.match(router, /response_format/); assert.match(router, /ALL_MODELS_FAILED/);
  assert.match(router, /queryV2VectorIndex/); assert.match(router, /VECTOR_SEARCH_URL/);
  for (const identity of ["name", "studentIds", "userId", "accountId", "phone", "email", "guardian", "contact"]) assert.match(privacy, new RegExp(identity));
  assert.match(assistant, /createApproval/); assert.match(assistant, /requiredOutput/); assert.match(assistant, /workspaceSnapshot/);
  for (const evidence of ["todayLessons", "overdueLessons", "assignmentQueue", "anonymousAttentionProfiles", "weakKnowledgeEvidence", "financeExceptions"]) assert.match(assistant, new RegExp(evidence));
  assert.match(assistant, /assistant_assigned_classes/);
  assert.match(assistant, /allowedActions\.has/);
  assert.match(assistant, /actionsRequiringEntityId/);
  assert.match(assistant, /knownNames: evidenceContext\.knownNames/);
  assert.match(assistant, /if \(repeated\)/);
  assert.doesNotMatch(router, /sk-[A-Za-z0-9]{20,}/);
});

test("assistant staff accounts have revocable sessions, class scope and teacher-only approval decisions", async () => {
  const [migration, auth, access, login, logout, settings, layout, shell, approvals, approvalRoute, passwordRoute] = await Promise.all([
    read("drizzle/0031_staff_authentication.sql"), read("app/lib/staff-auth.ts"), read("app/lib/access.ts"), read("app/api/auth/login/route.ts"), read("app/api/auth/logout/route.ts"), read("app/api/settings/route.ts"), read("app/v2/layout.tsx"), read("app/v2/V2Shell.tsx"), read("app/lib/v2/approval-service.ts"), read("app/api/v2/approvals/[id]/route.ts"), read("app/api/auth/staff-password/route.ts"),
  ]);
  for (const table of ["staff_credentials", "staff_login_attempts"]) assert.match(migration, new RegExp(table));
  for (const marker of ["PBKDF2", "session_version", "zhishi_staff", "HttpOnly", "SameSite=Lax", "revokeStaffSessions"]) assert.match(auth, new RegExp(marker));
  assert.match(access, /getStaffSession/); assert.match(access, /authType: "staff"/); assert.match(access, /staff_class_access/);
  assert.match(login, /verifyStaffCredentials/); assert.match(login, /createStaffSessionCookie/); assert.match(logout, /clearStaffSessionCookie/);
  assert.match(settings, /setStaffPassword/); assert.match(settings, /setClassAccess/); assert.match(settings, /access\.authType !== "teacher_admin"/);
  assert.doesNotMatch(layout, /requireTeacherAdmin/); assert.match(layout, /role=\{access\.role/); assert.match(shell, /teacherOnly/);
  assert.match(approvals, /access\.role === "teacher"/); assert.match(approvalRoute, /只有主教师可以作最终确认/); assert.match(passwordRoute, /changeStaffPassword/);
  assert.doesNotMatch(auth + settings + passwordRoute, /sk-[A-Za-z0-9]{20,}/);
});

test("approval center executes only whitelisted teacher-confirmed mutations", async () => {
  const [route, executor] = await Promise.all([read("app/api/v2/approvals/[id]/route.ts"), read("app/lib/v2/approval-executor.ts")]);
  assert.match(route, /executeApprovedAction/); assert.match(route, /current\.state !== "pending"/); assert.match(route, /repeated: true/);
  for (const action of ["question.promote", "schedule.adjust", "assignment.publish", "feedback.send", "paper.create_draft", "lesson.prepare_draft", "analysis.create_report", "academic_year.undo"]) assert.match(executor, new RegExp(action.replace(".", "\\.")));
  assert.match(executor, /access\.role !== "teacher"/); assert.match(executor, /status!='cancelled'/); assert.match(executor, /status='confirmed'/); assert.match(executor, /visibility\).*private|V2,待复核/);
});

test("V2 schedule import supports tables and vision with row review, idempotent confirm and safe undo", async () => {
  const service = await read("app/lib/v2/schedule-import-service.ts");
  for (const extension of ["xlsx", "csv", "png", "jpg", "jpeg", "webp", "pdf"]) assert.match(service, new RegExp(`"${extension}"`));
  for (const marker of ["inspectScheduleImportRow", "waiting_review", "v2_idempotency_operations", "schedule-confirm", "previous_json", "undoUntil", "assignments WHERE lesson_id", "feedback WHERE lesson_id"]) assert.match(service, new RegExp(marker));
  const routes = ["app/api/v2/schedule-imports/route.ts", "app/api/v2/schedule-imports/[id]/route.ts", "app/api/v2/schedule-imports/[id]/rows/[rowId]/route.ts", "app/api/v2/schedule-imports/[id]/confirm/route.ts", "app/api/v2/schedule-imports/[id]/undo/route.ts"];
  for (const route of routes) assert.ok((await read(route)).length > 30, `${route} must exist`);
});

test("long imports run in a leased background consumer with retry cancel and scheduled recovery", async () => {
  const [migration, jobs, dispatch, worker, schedule, questions, scheduleUi, questionUi] = await Promise.all([
    read("drizzle/0033_v2_background_job_leases.sql"), read("app/lib/v2/job-service.ts"), read("app/lib/v2/background-dispatch.ts"), read("worker/index.ts"), read("app/lib/v2/schedule-import-service.ts"), read("app/lib/v2/question-import-service.ts"), read("app/v2/schedule-imports/ScheduleWorkspace.tsx"), read("app/v2/questions/QuestionSearch.tsx"),
  ]);
  for (const field of ["available_at", "attempt_count", "max_attempts", "lease_owner", "lease_until", "v2_jobs_background_claim_index"]) assert.match(migration, new RegExp(field));
  for (const marker of ["claimBackgroundJob", "attempt_count<max_attempts", "requeueBackgroundJob", "retry_wait", "requestJobCancel"]) assert.match(jobs, new RegExp(marker));
  assert.match(dispatch, /schedule-import/); assert.match(dispatch, /question-import/); assert.match(dispatch, /waitUntil/); assert.match(dispatch, /drainV2BackgroundJobs/);
  assert.match(worker, /scheduled/); assert.match(worker, /drainV2BackgroundJobs/);
  assert.match(schedule, /processScheduleImportJobV2/); assert.match(schedule, /FILES\.get/); assert.match(schedule, /cancelRequested/);
  assert.match(questions, /processQuestionImportJobV2/); assert.match(questions, /FILES\.get/); assert.match(questions, /cancelRequested/);
  assert.match(scheduleUi, /setInterval/); assert.match(scheduleUi, /从原文件续跑/); assert.match(questionUi, /可以关闭页面，任务会继续/);
});

test("V2 question workflow exposes progressive hybrid search and intelligent multi-format intake", async () => {
  const [search, intake, ui] = await Promise.all([read("app/lib/v2/question-search.ts"), read("app/lib/v2/question-import-service.ts"), read("app/v2/questions/QuestionSearch.tsx")]);
  for (const marker of ["v2_questions_fts", "keywordScore", "semanticScore", "rerankScore", "matchReasons", "cosineSimilarity", "parsedFilters", "coverage"]) assert.match(search, new RegExp(marker));
  for (const extension of ["docx", "pdf", "png", "xlsx", "csv"]) assert.match(intake, new RegExp(`"${extension}"`));
  assert.match(intake, /parsePoliticsDocx/); assert.match(intake, /callV2AiJson/); assert.match(intake, /waiting_review/);
  assert.match(ui, /phase: "lexical"/); assert.match(ui, /phase: "semantic"/); assert.match(ui, /为什么命中|matchReasons/); assert.match(ui, /api\/v2\/questions\/imports/);
});

test("student and parent mini program uses the versioned contract and excludes teacher-only pages", async () => {
  const [app, api] = await Promise.all([read("mini-program/app.json"), read("mini-program/utils/api.js")]);
  assert.match(api, /\/api\/v2\/mini/); assert.doesNotMatch(api, /v2Path|\/api\/mini/); assert.match(api, /onProgressUpdate/); assert.match(api, /mini-sync-cursor/);
  for (const page of ["pages/home/index", "pages/dictation/index", "pages/class-files/index", "pages/notices/index", "pages/assignment/index", "pages/submit/index", "pages/bind/index", "pages/portal/index"]) assert.match(app, new RegExp(page));
  for (const page of ["pages/review/index", "pages/publish/index", "pages/inbox/index", "pages/annotate/index"]) assert.doesNotMatch(app, new RegExp(page));
  for (const page of ["review", "publish", "inbox", "annotate"]) await assert.rejects(read(`mini-program/pages/${page}/index.js`), { code: "ENOENT" });
  for (const route of ["accounts", "classes"]) await assert.rejects(read(`app/api/v2/mini/${route}/route.ts`), { code: "ENOENT" });
  for (const route of ["login", "assignments", "dictations", "class-files", "notices", "submissions", "portal", "sync", "files/[id]"]) assert.ok((await read(`app/api/v2/mini/${route}/route.ts`)).length > 20);
});

test("mobile records share one versioned D1 workflow across web iOS and mini", async () => {
  const [migration, service, webRoute, approval, portal] = await Promise.all([read("drizzle/0030_mobile_records_and_sync.sql"), read("app/lib/v2/mobile-record-service.ts"), read("app/api/v2/mobile/records/route.ts"), read("app/lib/v2/approval-executor.ts"), read("app/api/v2/mini/portal/route.ts")]);
  for (const table of ["v2_mobile_records", "v2_mobile_record_changes"]) assert.match(migration, new RegExp(table));
  for (const marker of ["operationId", "baseVersion", "VERSION_CONFLICT", "confirmMobileRecordShare", "recordSyncEvent"]) assert.match(service + webRoute, new RegExp(marker));
  assert.match(service, /audienceRole = audience === "both" \? null : audience/);
  assert.match(approval, /mobile_record\.share/); assert.match(portal, /v2_mobile_records/); assert.match(portal, /status='confirmed'/);
});

test("PWA supports home-screen launch and an offline teacher outbox", async () => {
  const [layout, manifest, entry, worker, offline, page] = await Promise.all([read("app/layout.tsx"), read("public/manifest.webmanifest"), read("app/record/page.tsx"), read("public/sw.js"), read("public/offline-record.html"), read("app/v2/record/RecordWorkspace.tsx")]);
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/); assert.match(layout, /appleWebApp/); assert.match(manifest, /"display": "standalone"/); assert.match(manifest, /"start_url": "\/record\?source=pwa"/); assert.match(entry, /teacherAdminSignInPath\("\/v2\/record"\)/);
  assert.match(worker, /offline-record\.html/); assert.match(offline, /zhishi-mobile-outbox-v1/); assert.match(page, /zhishi-mobile-outbox-v1/); assert.match(page, /提交共享确认/);
});

test("native iOS app is SwiftUI-first and uses the same authenticated mobile API", async () => {
  const [project, app, api, store, records, settings, privacy] = await Promise.all([read("ios/project.yml"), read("ios/ZhishiMobile/ZhishiMobileApp.swift"), read("ios/ZhishiMobile/APIClient.swift"), read("ios/ZhishiMobile/RecordStore.swift"), read("ios/ZhishiMobile/RecordListView.swift"), read("ios/ZhishiMobile/SettingsView.swift"), read("ios/ZhishiMobile/PrivacyInfo.xcprivacy")]);
  assert.match(project, /iOS: "17\.0"/); assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER/); assert.match(app, /TabView/); assert.match(records, /NavigationStack/); assert.match(records, /Form/); assert.match(records, /systemImage/);
  assert.match(api, /scheme\?\.lowercased\(\) == "https"/); assert.match(api, /components\.user == nil/); assert.match(api, /X-Operation-Id/); assert.match(store, /mobileRecordOutboxV1/); assert.match(store, /keepConflict/); assert.match(store, /requestShare/); assert.match(store, /\/api\/v2\/mobile\/records/); assert.match(records, /editing\(record\)/); assert.match(settings, /同一后端域名/); assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults/);
});

test("remaining teaching modules use native V2 workspaces instead of legacy redirects", async () => {
  const [page, workspace] = await Promise.all([read("app/v2/modules/[slug]/page.tsx"), read("app/v2/modules/[slug]/ModuleWorkspace.tsx")]);
  for (const moduleName of ["students", "papers", "assignments", "learning", "resources", "finance"]) assert.match(page, new RegExp(`${moduleName}:`));
  for (const endpoint of ["students", "classes", "lessons", "assignments", "papers", "analytics", "feedback", "reflections", "resources", "finance"]) {
    assert.ok((await read(`app/api/v2/${endpoint}/route.ts`)).includes("export {"), `${endpoint} must expose the versioned contract`);
    assert.match(workspace, new RegExp(`/api/v2/${endpoint}`));
  }
  assert.doesNotMatch(page, /legacy:|打开业务数据|href=\{item\.legacy\}/);
  assert.match(workspace, /status: "draft"/);
  assert.match(workspace, /待确认中心/);
});

test("assessment operations and system settings are native V2 safety-gated workspaces", async () => {
  const [operations, settings, routing] = await Promise.all([read("app/v2/operations/OperationsWorkspace.tsx"), read("app/v2/settings/SettingsWorkspace.tsx"), read("app/api/v2/settings/ai-routing/route.ts")]);
  for (const endpoint of ["assessments", "exam-projects", "recognition", "feedback-imports", "academic-years", "calendar/subscription", "settings"]) assert.match(operations + settings, new RegExp(`/api/v2/${endpoint}`));
  assert.match(operations, /rotationArmed/);
  assert.match(operations, /晋升影响快照/);
  assert.match(operations, /academic_year\.promote/);
  assert.match(operations, /excludedStudentIds/);
  assert.match(operations, /本次排除/);
  assert.doesNotMatch(operations, /action:\s*["']confirm["']/);
  assert.match(routing, /costOrTokenFeatureLimit: false/);
  assert.match(routing, /Boolean\(env\.OPENAI_API_KEY\)/);
  assert.doesNotMatch(routing + settings, /sk-[A-Za-z0-9]{20,}/);
});

test("V2 assignment review, publishing, feedback sending and paper creation remain teacher-controlled", async () => {
  const [workspace, search, approvals, executor] = await Promise.all([read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/v2/questions/QuestionSearch.tsx"), read("app/api/v2/approvals/route.ts"), read("app/lib/v2/approval-executor.ts")]);
  for (const action of ["assignment.publish", "submission.review_confirm", "feedback.send"]) {
    const pattern = new RegExp(action.replace(".", "\\.")); assert.match(workspace, pattern); assert.match(approvals, pattern); assert.match(executor, pattern);
  }
  assert.match(workspace, /\/api\/v2\/assignments\/\$\{selectedId\}\/submissions/);
  assert.match(workspace, /提交到待确认中心/);
  assert.match(executor, /recordSyncEvent/);
  assert.match(search, /选题篮/);
  assert.match(search, /\/api\/v2\/papers/);
  assert.match(search, /status: "draft"/);
});

test("AI submission review is evidence-bound, anonymized and remains an editable teacher draft", async () => {
  const [route, workspace, router] = await Promise.all([read("app/api/v2/assignments/[id]/submissions/[submissionId]/ai-review/route.ts"), read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/lib/v2/ai-router.ts")]);
  for (const marker of ["paper_questions", "scoringPoints", "priorRevisionRequirements", "attachment_metadata", "knownNames", "SCHEMA_INVALID", "suggestedScore", "createJob", "v2_ai_runs"]) assert.match(route + router, new RegExp(marker));
  assert.match(route, /requireClassAccess/);
  assert.match(route, /AI 批改建议/);
  assert.match(route, /waitUntil/);
  assert.doesNotMatch(route, /UPDATE assignment_submissions/);
  assert.match(workspace, /\/ai-review/);
  assert.match(workspace, /AI 生成批改建议/);
  assert.match(workspace, /submission\.review_confirm/);
  assert.match(workspace, /reviewTags: draft\.reviewTags/);
  assert.match(workspace, /\/api\/v2\/jobs/);
});

test("V2 finance recomputes evidence before approval execution", async () => {
  const [route, receipt, executor, workspace, approvals] = await Promise.all([read("app/api/v2/finance/approvals/route.ts"), read("app/api/v2/finance/receipts/route.ts"), read("app/lib/v2/approval-executor.ts"), read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/api/v2/approvals/route.ts")]);
  for (const marker of ["resolvePricingContext", "calculateLessonFinance", "previewFingerprint", "createApproval", "finance.confirm"]) assert.match(route, new RegExp(marker.replace(".", "\\.")));
  assert.match(executor, /fingerprint !== String\(payload\.fingerprint/);
  assert.match(executor, /confirmFinanceSettlement/);
  assert.match(workspace, /\/api\/v2\/finance\/approvals/);
  assert.match(receipt, /finance\.receive/);
  assert.match(receipt, /currentReceived/);
  assert.match(executor, /approval\.actionType === "finance\.receive"/);
  assert.match(executor, /received_amount=\?,status=\?/);
  assert.match(approvals, /finance\.receive/);
  assert.match(workspace, /\/api\/v2\/finance\/receipts/);
  assert.match(workspace, /登记实际收款/);
  assert.match(workspace, /提交到待确认中心/);
});

test("V2 imported questions can be edited but only approvals promote them", async () => {
  const [route, search, executor] = await Promise.all([read("app/api/v2/questions/[id]/review-draft/route.ts"), read("app/v2/questions/QuestionSearch.tsx"), read("app/lib/v2/approval-executor.ts")]);
  assert.match(route, /existing\.status === "active"/);
  assert.match(route, /review_status='pending'/);
  assert.match(search, /\/review-draft/);
  assert.match(search, /question\.promote/);
  assert.match(search, /提交正式入库确认/);
  assert.match(executor, /UPDATE questions SET status='active'/);
});

test("student class lesson and paper details stay inside the V2 shell", async () => {
  const [workspace, detail] = await Promise.all([read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/v2/detail/[kind]/[id]/EntityDetail.tsx")]);
  for (const kind of ["students", "classes", "lessons", "papers"]) {
    assert.match(workspace, new RegExp(`/v2/detail/${kind}`));
    assert.match(detail, new RegExp(`/api/v2/\\$\\{kind\\}/\\$\\{id\\}`));
    assert.ok((await read(`app/api/v2/${kind}/[id]/route.ts`)).includes("export {"));
  }
  assert.match(detail, /knowledgeEvidence/);
  assert.match(detail, /memberAction/);
  assert.match(detail, /教学目标/);
  assert.match(detail, /难度梯度/);
});

test("resource detail can be edited inside V2 without changing its visibility implicitly", async () => {
  const [workspace, detail, route] = await Promise.all([read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/v2/detail/[kind]/[id]/EntityDetail.tsx"), read("app/api/v2/resources/[id]/route.ts")]);
  assert.match(workspace, /\/v2\/detail\/resources/);
  assert.match(detail, /ResourceDetail/);
  assert.match(route, /resources:write/);
  assert.match(route, /UPDATE resources SET title=\?,type=\?,url=\?,tags=\?,content=\?/);
  assert.doesNotMatch(route, /visibility=\?/);
});

test("50k question performance has explicit release gates and cached similarity profiles", async () => {
  const [similarity, candidates, benchmark] = await Promise.all([read("app/lib/question-similarity.ts"), read("app/lib/question-import-candidates.ts"), read("scripts/scale-benchmark.mjs")]);
  assert.match(similarity, /questionTextProfile/);
  assert.match(similarity, /profiledQuestionTextSimilarity/);
  assert.match(candidates, /candidateProfiles/);
  assert.match(candidates, /refProfiles/);
  assert.match(benchmark, /similarityCandidateFillMs/);
  assert.match(benchmark, /duplicateRecall/);
  assert.match(benchmark, /if \(!gatesPassed\) process\.exitCode = 1/);
});

test("V2 deep operations keep formal scores promotions and reverse imports behind approval", async () => {
  const [detail, operations, approvals, executor, assignment, submissions, paper, recognition] = await Promise.all([read("app/v2/operations/[kind]/[id]/OperationDetail.tsx"), read("app/v2/operations/OperationsWorkspace.tsx"), read("app/api/v2/approvals/route.ts"), read("app/lib/v2/approval-executor.ts"), read("app/v2/modules/[slug]/ModuleWorkspace.tsx"), read("app/api/assignments/[id]/submissions/route.ts"), read("app/v2/detail/[kind]/[id]/EntityDetail.tsx"), read("app/api/recognition/route.ts")]);
  for (const action of ["assessment.complete", "recognition.confirm", "academic_year.promote", "feedback_import.confirm"]) {
    const pattern = new RegExp(action.replace(".", "\\.")); assert.match(detail + operations, pattern); assert.match(approvals, pattern); assert.match(executor, pattern);
  }
  for (const marker of ["逐题人工校对", "保存成绩草稿", "previewToken", "提交正式写入确认"]) assert.match(detail + operations, new RegExp(marker));
  for (const marker of ["assetIds", "reviewAssetIds", "annotation", "audio", "/api/v2/assignments/files"]) assert.match(assignment + executor + submissions, new RegExp(marker));
  assert.match(paper, /\/api\/v2\/papers\/\$\{id\}\/export/);
  assert.match(paper, /打印 \/ 存为 PDF/);
  assert.match(detail, /查看原答题卡/);
  assert.match(detail, /recognition_crop/);
  assert.match(recognition, /crop_asset_id=\?/);
  assert.match(recognition, /mime_type LIKE 'image\/%'/);
  for (const marker of ["aiRecognize", "realNameContextConfirmed", "callV2AiJson", "preservedConfirmed", "stage='failed'", "answer-card-recognition-v2.1", "waitUntil", "cancelRequested"]) assert.match(recognition, new RegExp(marker.replace(".", "\\.")));
  assert.match(detail, /AI 重新识别/);
  assert.match(detail, /原答题卡发送给外部视觉模型/);
});

test("every newly versioned route has an explicit contract inventory reference", async () => {
  const contractPaths = [
    "/api/v2/academic-years", "/api/v2/academic-years/[year]/promotion", "/api/v2/academic-years/[year]/promotion/undo", "/api/v2/analytics", "/api/v2/assessments", "/api/v2/assessments/[id]",
    "/api/v2/assignments", "/api/v2/assignments/[id]/submissions", "/api/v2/assignments/[id]/submissions/[submissionId]/ai-review", "/api/v2/assignments/files", "/api/v2/calendar/subscription", "/api/v2/classes", "/api/v2/classes/[id]", "/api/v2/dictations", "/api/v2/class-files", "/api/v2/class-files/[id]", "/api/v2/class-files/[id]/content", "/api/v2/notices", "/api/v2/notices/[id]",
    "/api/v2/exam-projects", "/api/v2/exam-projects/[id]/results", "/api/v2/exam-projects/[id]/analytics", "/api/v2/feedback", "/api/v2/feedback-imports", "/api/v2/feedback-imports/[id]", "/api/v2/finance", "/api/v2/finance/receipts", "/api/v2/jobs", "/api/v2/jobs/[id]",
    "/api/v2/lessons", "/api/v2/lessons/[id]", "/api/v2/mobile/dashboard", "/api/v2/mobile/records/[id]/share",
    "/api/v2/papers", "/api/v2/papers/[id]", "/api/v2/papers/[id]/export", "/api/v2/papers/[id]/export-job", "/api/v2/questions/[id]/similar", "/api/v2/questions/batch-review",
    "/api/v2/questions/imports", "/api/v2/questions/imports/[id]", "/api/v2/questions/search", "/api/v2/recognition", "/api/v2/recognition/[id]",
    "/api/v2/reflections", "/api/v2/resources", "/api/v2/resources/[id]", "/api/v2/settings", "/api/v2/settings/ai", "/api/v2/students", "/api/v2/students/[id]",
    "/api/v2/mini/assignments", "/api/v2/mini/dictations", "/api/v2/mini/class-files", "/api/v2/mini/notices", "/api/v2/mini/notices/[id]/read", "/api/v2/mini/bind", "/api/v2/mini/bindings/[id]",
    "/api/v2/mini/excellent", "/api/v2/mini/files", "/api/v2/mini/files/[id]", "/api/v2/mini/invites", "/api/v2/mini/login",
    "/api/v2/mini/logout", "/api/v2/mini/me", "/api/v2/mini/paper-files/[id]", "/api/v2/mini/portal", "/api/v2/mini/submissions", "/api/v2/mini/sync",
  ];
  for (const route of contractPaths) assert.ok((await read(`app${route}/route.ts`)).length > 20, `${route} contract route must exist`);
});

test("local D1 initializer accepts the database file before a slow CI route finishes compiling", async () => {
  const initializer = await read("scripts/init-local-d1.mjs");
  assert.match(initializer, /if \(await findAnySqlite\(\)\) return/);
  assert.match(initializer, /路由可能在 D1 已经落盘后仍等待 SSR 编译/);
});
