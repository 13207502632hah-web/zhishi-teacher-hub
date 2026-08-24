import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("assignments are consolidated into the V2 module and every old entry is retired", async () => {
  const [page, workspace, navigation, shell, lesson, layout] = await Promise.all([
    read("app/v2/modules/[slug]/page.tsx"),
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/components/navigation.ts"),
    read("app/components/AppShell.tsx"),
    read("app/v2/detail/[kind]/[id]/LessonDetailWorkspace.tsx"),
    read("app/layout.tsx"),
  ]);

  assert.match(page, /initialSubmissionStatus/);
  assert.match(workspace, /function AssignmentWorkspace/);
  assert.match(navigation, /href: "\/v2\/modules\/assignments"/);
  assert.match(shell, /\/v2\/modules\/assignments\?submissionStatus=pending/);
  assert.match(lesson, /\/v2\/modules\/assignments\?lessonId=/);
  assert.doesNotMatch(layout, /assignments\.css/);
  await assert.rejects(access(new URL("../app/assignments/page.tsx", import.meta.url)));
  await assert.rejects(access(new URL("../app/assignments.css", import.meta.url)));
});

test("assignment filters and deep links cover status, class, lesson, search and submission state", async () => {
  const [page, workspace] = await Promise.all([
    read("app/v2/modules/[slug]/page.tsx"),
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
  ]);

  for (const input of ["initialQuery", "initialLessonId", "initialClassId", "initialStatus", "initialSubmissionStatus"]) assert.match(page + workspace, new RegExp(input));
  for (const label of ["作业状态", "班级", "关联课时", "收交状态", "有待处理学生", "待批改", "待订正", "已完成"]) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /useMemo/);
  assert.match(workspace, /pendingReviewCount/);
  assert.match(workspace, /revisionCount/);
  assert.match(workspace, /completedCount/);
});

test("assignment creation supports class or students, lesson, paper and private attachments", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  for (const marker of ["班级（与指定学生二选一）", "指定学生", "关联课时", "关联试卷", "作业附件", "允许家长代交", "需要保留订正版"]) assert.match(workspace, new RegExp(marker));
  assert.match(workspace, /studentIds: selectedStudentIds\.map\(Number\)/);
  assert.match(workspace, /operationId: crypto\.randomUUID\(\)/);
  assert.match(workspace, /status: "draft"/);
  assert.match(workspace, /\/api\/v2\/assignments\/files/);
  assert.match(workspace, /作业草稿已私密保存/);
  assert.doesNotMatch(workspace, /status: "published"/);
});

test("publishing and final review remain approval-backed while review drafts stay private", async () => {
  const [workspace, submissionsRoute, createRoute, reviewRoute] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/api/v2/assignments/[id]/submissions/route.ts"),
    read("app/api/v2/assignments/route.ts"),
    read("app/api/v2/assignments/[id]/submissions/route.ts"),
  ]);

  assert.match(workspace, /actionType: "assignment\.publish"/);
  assert.match(workspace, /actionType: "submission\.review_confirm"/);
  assert.match(workspace, /action: "save-review"/);
  assert.match(workspace, /批改草稿已私密保存/);
  assert.match(workspace, /提交到待确认中心/);
  assert.match(submissionsRoute, /export async function GET/);
  assert.match(submissionsRoute, /export async function POST/);
  assert.match(createRoute, /\{ \.\.\.body, status: "draft" \}/);
  assert.match(reviewRoute, /body\.action !== "save-review"/);
  assert.match(reviewRoute, /正式批改请提交到待确认中心/);
  assert.doesNotMatch(workspace, /action: "confirm-review"/);
});

test("AI review is evidence-bound, resumable and never writes a formal result directly", async () => {
  const workspace = await read("app/v2/modules/[slug]/ModuleWorkspace.tsx");

  assert.match(workspace, /\/ai-review/);
  assert.match(workspace, /\/api\/v2\/jobs\//);
  assert.match(workspace, /AI 草稿 · 置信度/);
  assert.match(workspace, /ai_review_draft/);
  assert.match(workspace, /uncertainty/);
  assert.match(workspace, /提交到待确认中心|提交确认并回传审批/);
});

test("assignment workbench cancels stale reads, protects unfinished creation and is phone-safe", async () => {
  const [workspace, css] = await Promise.all([
    read("app/v2/modules/[slug]/ModuleWorkspace.tsx"),
    read("app/v2/v2.css"),
  ]);

  assert.match(workspace, /AbortController/);
  assert.match(workspace, /controller\.abort/);
  assert.match(workspace, /beforeunload/);
  assert.match(workspace, /if \(createBusy \|\| uploading\) return/);
  assert.match(workspace, /role="alert"/);
  assert.match(css, /\.v2-assignment-filters/);
  assert.match(css, /\.v2-review-actions/);
  assert.match(css, /@media\(max-width:720px\)[^{]*\{[^}]*\.v2-assignment-filters/s);
  assert.match(css, /min-height:44px/);
});
