import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const page = read("app/settings/page.tsx");
const settingsApi = read("app/api/settings/route.ts");
const aiApi = read("app/api/settings/ai/route.ts");
const dataApi = read("app/api/settings/data/route.ts");
const exportApi = read("app/api/settings/export/route.ts");
const demoApi = read("app/api/settings/demo/route.ts");
const passwordApi = read("app/api/auth/change-password/route.ts");

test("settings page is organized around the six safe, explicit sections", () => {
  for (const heading of [
    "账号与权限",
    "助教班级授权",
    "密码安全",
    "AI辅助设置",
    "演示数据",
    "数据导出与危险操作",
  ]) {
    assert.match(page, new RegExp(heading));
  }
  assert.match(page, /danger|危险操作/);
});

test("settings page uses requestJson for every request and exposes retryable states", () => {
  assert.match(page, /requestJson/);
  assert.doesNotMatch(page, /(?<![.\w])fetch\s*\(/, "settings must not bypass the shared request client");
  assert.match(page, /loading|加载/);
  assert.match(page, /error|失败/);
  assert.match(page, /retry|重试/);
  assert.match(page, /empty|空状态|暂无/);
  for (const endpoint of ["/api/settings", "/api/settings/ai", "/api/settings/demo"]) assert.match(page, new RegExp(endpoint));
});

test("sensitive settings actions have independent duplicate-submit guards", () => {
  for (const action of [
    "saveUser",
    "disableUser",
    "setClassAccess",
    "changePassword",
    "saveAi",
    "clearLearning",
    "seedDemo",
    "clearDemo",
    "exportData",
    "deleteData",
  ]) assert.match(page, new RegExp(action));
  assert.match(page, /busy/i);
  assert.match(page, /disabled=/);
  assert.match(page, /already|重复|进行中|exclusive|runExclusive/i);
});

test("dangerous dialogs protect focus, escape, focus restoration, and unsaved work", () => {
  assert.match(page, /useRef/);
  assert.match(page, /document\.activeElement/);
  assert.match(page, /event\.key\s*===\s*["']Escape["']/);
  assert.match(page, /event\.key\s*!==?\s*["']Tab["']/);
  assert.match(page, /\.focus\(\)/);
  assert.match(page, /beforeunload/);
  assert.match(page, /aria-modal=["']true["']/);
  assert.match(page, /未保存|unsaved/i);
});

test("data export is a requestJson success path and warns about student information", () => {
  assert.match(page, /requestJson[\s\S]*\/api\/settings\/export/);
  assert.doesNotMatch(page, /fetch\s*\(\s*["']\/api\/settings\/export/);
  assert.match(page, /学生|student/);
  assert.match(page, /Blob|下载/);
  assert.match(page, /导出失败/);
  assert.match(exportApi, /audit\(/);
});

test("delete-all data requires the exact phrase and a second confirmation", () => {
  assert.match(dataApi, /confirmation\s*!==\s*["']删除全部教学数据["']/);
  assert.match(page, /删除全部教学数据/);
  assert.match(page, /再次确认|二次确认|permanent|永久/);
  assert.match(page, /window\.confirm/);
  assert.doesNotMatch(page, /deleteData\s*=\s*async[^]*?fetch\s*\(/, "the destructive request must go through requestJson");
});

test("AI settings preserve stored false, zero-like, privacy, limit, and emergency values when a patch omits them", () => {
  assert.doesNotMatch(aiApi, /body\.enabled\s*\|\|/);
  assert.doesNotMatch(aiApi, /body\.includeStudentName\s*\|\|/);
  assert.doesNotMatch(aiApi, /body\.dailyLimit\s*\|\|\s*50/);
  assert.doesNotMatch(aiApi, /body\.emergencyDisabled\s*\|\|/);
  assert.match(aiApi, /undefined|existing|current/i);
  assert.match(page, /aiBoolean/);
});

test("assistant scope is checked again on the server and only active assistants receive class grants", () => {
  assert.match(settingsApi, /status\s*=\s*['"]active['"]/i);
  assert.match(settingsApi, /staff_class_access/);
  assert.match(settingsApi, /classIds/);
  assert.match(settingsApi, /audit\([^)]*assign_class_scope/);
});

test("demo operations retain tracking and explicitly limit clearing to marked records", () => {
  assert.match(demoApi, /demo_records/);
  assert.match(demoApi, /DEMO_SCENARIO_VERSION/);
  assert.match(demoApi, /DELETE FROM demo_records/);
  assert.match(demoApi, /clear_demo/);
  assert.match(page, /【演示】/);
  assert.match(page, /真实教学数据不受影响|真实教学记录不会受影响/);
});

test("demo cleanup removes paper dependents before tracked demo papers", () => {
  const deleteAssessmentResults = demoApi.indexOf("DELETE FROM assessment_results");
  const deleteAssessments = demoApi.indexOf("DELETE FROM assessments");
  const clearAssessmentPaper = demoApi.indexOf("UPDATE assessments SET paper_id=NULL");
  const deleteQuestionSets = demoApi.indexOf("DELETE FROM question_sets");
  const clearQuestionSetPaper = demoApi.indexOf("UPDATE question_sets SET paper_id=NULL");
  const deleteExportJobs = demoApi.indexOf("DELETE FROM export_jobs");
  const deletePaperFiles = demoApi.indexOf("DELETE FROM paper_files");
  const clearWorkflowPaper = demoApi.indexOf("UPDATE lesson_workflow_state SET homework_paper_id=NULL");
  const clearExamProjectPaper = demoApi.indexOf("UPDATE exam_projects SET paper_id=NULL");
  const deletePapers = demoApi.indexOf("DELETE FROM papers");

  for (const [label, index] of Object.entries({
    deleteAssessmentResults,
    deleteAssessments,
    clearAssessmentPaper,
    deleteQuestionSets,
    clearQuestionSetPaper,
    deleteExportJobs,
    deletePaperFiles,
    clearWorkflowPaper,
    clearExamProjectPaper,
    deletePapers,
  })) {
    assert.ok(index >= 0, `missing ${label} cleanup`);
  }
  assert.ok(deleteAssessmentResults < deleteAssessments, "assessment results must be removed before assessments");
  assert.ok(deleteAssessments < deletePapers, "assessments still reference their paper and must be removed first");
  assert.ok(deleteQuestionSets < deletePapers, "question sets may still reference their source paper and must be removed first");
  for (const index of [clearAssessmentPaper, clearQuestionSetPaper, deleteExportJobs, deletePaperFiles, clearWorkflowPaper, clearExamProjectPaper]) {
    assert.ok(index < deletePapers, "every paper foreign-key dependent must be cleared before tracked demo papers");
  }
});

test("password flow clears client fields and explains old-session invalidation without echoing secrets", () => {
  assert.match(page, /currentPassword/);
  assert.match(page, /setPasswordForm\(\{\s*\.\.\.blankPassword\s*\}\)|setPasswordForm\(\{\s*currentPassword:\s*["']{2}/);
  assert.match(page, /旧会话|旧登录|otherSessionsInvalidated/);
  assert.doesNotMatch(page, /setMessage\([^\n]*(currentPassword|newPassword|confirmPassword)/);
  assert.match(passwordApi, /Cache-Control/);
});

test("settings styles are isolated in a CSS Module with readable text and touch targets", () => {
  const cssPath = path.join(root, "app/settings/settings.module.css");
  assert.ok(fs.existsSync(cssPath), "settings page must have a CSS Module");
  const css = fs.readFileSync(cssPath, "utf8");
  assert.match(css, /font-size\s*:\s*(1rem|16px)/);
  assert.match(css, /font-size\s*:\s*(0\.875rem|14px)/);
  assert.match(css, /min-(?:width|height)\s*:\s*44px/);
  assert.match(css, /@media\s*\(min-width:\s*768px\)/);
  assert.match(css, /@media\s*\(min-width:\s*1024px\)/);
});
