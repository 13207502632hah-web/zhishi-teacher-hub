import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("academic year promotion is preview-first and enters the approval center", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  for (const marker of ["学年晋升", "查看晋升预览", "晋升影响快照", "本次排除", "待确认中心"]) assert.match(page, new RegExp(marker));
  assert.match(page, /previewPromotion/);
  assert.match(page, /requestPromotionApproval/);
  assert.match(page, /actionType: "academic_year\.promote"/);
  assert.doesNotMatch(page, /confirmation: "确认晋升"/);
});

test("promotion preview uses the shared V2 JSON client and recoverable states", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /json\(`\/api\/v2\/academic-years/);
  assert.match(page, /晋升预览生成失败/);
  assert.match(page, /v2-alert v2-error/);
  assert.match(page, /暂无记录/);
});

test("promotion preview exposes impact counts, skipped rows and stale-data evidence", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");

  for (const field of [
    "affectedStudentCount",
    "affectedClassCount",
    "graduationCount",
    "skippedCount",
    "conflictCount",
    "previewToken",
    "previewExpiresAt",
  ]) {
    assert.match(page, new RegExp(field));
  }
  assert.match(page, /系统跳过项/);
  assert.match(page, /previewExpiresAt/);
  assert.match(page, /快照过期或有冲突会自动中止/);
  assert.match(page, /冲突/);
  assert.match(page, /跳过/);
  assert.match(page, /毕业/);
});

test("promotion confirmation is teacher-only, explicit, and cannot bypass approval", async () => {
  const [page, workspace] = await Promise.all([read("app/v2/operations/page.tsx"), read("app/v2/operations/OperationsWorkspace.tsx")]);
  assert.match(page, /role !== "teacher"/);
  assert.match(workspace, /disabled=\{busy \|\| count\(summary\.conflictCount\) > 0/);
  assert.match(workspace, /previewToken/);
  assert.match(workspace, /\/api\/v2\/approvals/);
  assert.match(workspace, /当前学生与班级尚未变更/);
});

test("confirmed promotion exposes a second explicit path for safe undo", async () => {
  const page = await read("app/v2/operations/OperationsWorkspace.tsx");
  assert.match(page, /runStatus === "confirmed"/);
  assert.match(page, /undoAvailable/);
  assert.match(page, /申请安全撤销本次晋升/);
  assert.match(page, /批准并再次核对前不会修改学生年级/);
});

test("带学年查询参数会直接打开 V2 学年页签并生成对应预览", async () => {
  const [page, workspace, dashboard] = await Promise.all([read("app/v2/operations/page.tsx"), read("app/v2/operations/OperationsWorkspace.tsx"), read("app/api/v2/dashboard/route.ts")]);
  assert.match(page, /query\.year/);
  assert.match(page, /initialAcademicYear/);
  assert.match(workspace, /initialTab === "academic" && initialAcademicYear/);
  assert.match(dashboard, /\/v2\/operations\?tab=academic&year=/);
});

test("academic year promotion uses the shared responsive V2 workbench", async () => {
  const [page, css] = await Promise.all([read("app/v2/operations/OperationsWorkspace.tsx"), read("app/v2/v2.css")]);
  assert.match(page, /v2-promotion-preview/);
  assert.match(page, /v2-promotion-students/);
  assert.match(page, /v2-promotion-skipped/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /v2-promotion-skipped/);
});

test("promotion API separates teacher confirmation from preview access and rejects stale confirmations", async () => {
  const route = await read("app/api/v2/academic-years/[year]/promotion/route.ts");

  assert.match(route, /academicYearDates/);
  assert.match(route, /requirePermission\("academic-years:read"\)/);
  assert.match(route, /requirePermission\("academic-years:write"\)/);
  assert.match(route, /access\.role === "teacher"/);
  assert.match(route, /previewToken/);
  assert.match(route, /previewExpiresAt/);
  assert.match(route, /requiresPreview: true/);
  assert.match(route, /status:\s*409/);
  assert.match(route, /confirmation === "确认晋升"/);
  assert.match(route, /冲突/);
  assert.match(route, /skipped/);
  assert.match(route, /affectedClassCount/);
  assert.match(route, /graduationCount/);
});

test("promotion API guards the batch and does not report repeated requests as success", async () => {
  const route = await read("app/api/v2/academic-years/[year]/promotion/route.ts");

  assert.match(route, /status='confirming'/);
  assert.match(route, /status='preview'/);
  assert.match(route, /env\.DB\.batch/);
  assert.match(route, /AND grade=\?/);
  assert.match(route, /NOT EXISTS/);
  assert.match(route, /status='confirmed'/);
  assert.match(route, /updated_at/);
  assert.doesNotMatch(route, /repeated:\s*true/);
  assert.match(route, /确认失败|晋升未完成/);
});

test("confirmed promotion has a teacher-approved 24-hour conflict-safe undo", async () => {
  const [route, undo, migration, approvals, executor, operations] = await Promise.all([
    read("app/api/v2/academic-years/[year]/promotion/route.ts"),
    read("app/api/v2/academic-years/[year]/promotion/undo/route.ts"),
    read("drizzle/0032_promotion_safe_undo.sql"),
    read("app/api/v2/approvals/route.ts"),
    read("app/lib/v2/approval-executor.ts"),
    read("app/v2/operations/OperationsWorkspace.tsx"),
  ]);
  for (const field of ["undo_until", "undone_by", "undone_at", "undo_reason"]) assert.match(migration, new RegExp(field));
  for (const marker of ["undoPromotion", "确认撤销晋升", "status='undoing'", "status='undone'", "undo_conflict", "compensation", "studentUpdatedAt", "expectedConfirmedAt"]) assert.match(route, new RegExp(marker));
  assert.match(route, /datetime\(undo_until\)>datetime\('now'\)/);
  assert.match(undo, /operationId/); assert.match(undo, /academic_year\.undo/); assert.match(undo, /undoOpen/); assert.match(undo, /createApproval/);
  assert.match(approvals, /academic_year\.undo/); assert.match(executor, /academic_year\.undo/); assert.match(executor, /undoPromotion/);
  assert.match(operations, /申请安全撤销本次晋升/); assert.match(operations, /promotion\/undo/);
});
