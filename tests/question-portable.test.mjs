import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js");

const tsModuleCache = new Map();
const requireTs = (absolutePath) => {
  if (tsModuleCache.has(absolutePath)) return tsModuleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const { outputText: code } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const evaluatedModule = { exports: {} };
  tsModuleCache.set(absolutePath, evaluatedModule);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return require(specifier);
    const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath)));
    return requireTs(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`);
  };
  new Function("module", "exports", "require", code)(evaluatedModule, evaluatedModule.exports, localRequire);
  return evaluatedModule.exports;
};

const loadTsModule = async (path) => {
  return requireTs(fileURLToPath(new URL(`../${path}`, import.meta.url)));
};

test("portable CSV template round-trips with quoted commas and newlines", async () => {
  const { parseQuestionCsv, portableTemplateCsv } = await loadTsModule("app/lib/question-portable.ts");
  const rows = parseQuestionCsv(portableTemplateCsv());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stem, "示例题干：全过程人民民主是最广泛、最真实、最管用的民主。");
  assert.match(rows[0].options, /\n/);
  assert.equal(rows[0].sourceQuestionNumber, "1");
});
test("portable CSV accepts Chinese aliases and quoted commas", async () => {
  const { parseQuestionCsv } = await loadTsModule("app/lib/question-portable.ts");
  const rows = parseQuestionCsv(`\uFEFF题号,题干,材料,答案,解析,知识点,题型,难度,年份
1,"带,逗号的题干","材料
第二行",A,"解析
含换行",法治,单选题,3,2026
2,第二题,材料二,B,解析二,宪法,判断题,2,2026`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stem, "带,逗号的题干");
  assert.equal(rows[0].material, "材料\n第二行");
  assert.equal(rows[0].sourceQuestionNumber, "1");
  assert.equal(rows[1].questionType, "判断题");
});

test("portable template JSON keeps schema and example rows", async () => {
  const { portableTemplateJson } = await loadTsModule("app/lib/question-portable.ts");
  const template = portableTemplateJson();
  assert.equal(template.schema, "zhishi-question-bank/v1");
  assert.equal(template.template, true);
  assert.equal(template.questions.length, 1);
  assert.equal(template.questions[0].questionType, "单选题");
});

test("automatic import enables questions without inventing answers or claiming human review", async () => {
  const { autoImportedQuestionValues } = await loadTsModule("app/lib/services/question-values.ts");
  const result = autoImportedQuestionValues({ stem: "原始题干", answer: "", analysis: "", knowledgePoints: "", reviewed: true, reviewStatus: "confirmed", status: "review", parseConfidence: 0.4, importNotes: ["缺少答案"] });
  assert.equal(result.status, "active");
  assert.equal(result.reviewStatus, "auto_checked");
  assert.equal(result.reviewed, false);
  assert.equal(result.answer, "");
  assert.equal(result.analysis, "");
  assert.equal(result.parseConfidence, 0.4);
  assert.match(result.notes, /缺少答案/);
});

test("all import entries use automatic admission and the import UI no longer requires review", async () => {
  const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const path of ["app/api/v2/question-sets/import/route.ts", "app/api/v2/questions/portable/route.ts"]) assert.match(await readSource(path), /autoImportedQuestionValues/);
  const intake = await readSource("app/lib/v2/question-import-service.ts");
  assert.match(intake, /state: "completed", stage: "completed", progress: 100/);
  const ui = await readSource("app/v2/questions/QuestionLibraryWorkspace.tsx");
  assert.doesNotMatch(ui, /const confirmSet|const storeReview|本题题干、答案、解析和知识点已经人工核对/);
  assert.match(ui, /将已导入题目直接入库/);
  const route = await readSource("app/api/v2/question-sets/[id]/route.ts");
  assert.match(route, /requirePermission\("questions:write"\)/);
  assert.match(route, /status='review' AND trim\(stem\)!=''/);
  assert.match(route, /auto_admit_import/);
});

test("portable route exposes template downloads and CSV import path", async () => {
  const [route, page, importRoute] = await Promise.all([
    readFile(new URL("../app/api/v2/questions/portable/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/v2/questions/QuestionLibraryWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v2/question-sets/import/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /template\s*=\s*params\.get\("template"\)\s*===\s*"1"/);
  assert.match(route, /portableTemplateCsv\(\)/);
  assert.match(route, /portableTemplateJson\(\)/);
  assert.match(route, /parseQuestionCsv\(raw\)/);
  assert.match(route, /format: isCsv \? "csv" : "json"/);
  assert.match(page, /模板 JSON/);
  assert.match(page, /模板 CSV/);
  assert.match(page, /导入 JSON\/CSV/);
  assert.match(page, /summary\.numberingIssues/);
  assert.match(page, /题号异常清单/);
  assert.match(importRoute, /numberingIssues/);
});

test("numbering validation reports duplicates and sequence gaps", async () => {
  const { summarizeImport } = await loadTsModule("app/lib/question-import.ts");
  const summary = summarizeImport([
    { questionType: "单选题", answer: "A", knowledgePoints: "法治", analysis: "解析一", sourceQuestionNumber: 1 },
    { questionType: "单选题", answer: "B", knowledgePoints: "法治", analysis: "解析二", sourceQuestionNumber: 2 },
    { questionType: "单选题", answer: "C", knowledgePoints: "法治", analysis: "解析三", sourceQuestionNumber: 2 },
    { questionType: "材料题", answer: "答案", knowledgePoints: "民主", analysis: "解析四", sourceQuestionNumber: 5 },
  ]);
  assert.deepEqual(summary.numberingIssues, [
    { index: 2, number: 2, issue: "duplicate" },
    { index: 3, number: 3, issue: "gap" },
    { index: 3, number: 4, issue: "gap" },
  ]);
  assert.deepEqual(summarizeImport([{ questionType: "单选题", answer: "A", knowledgePoints: "法治", analysis: "解析" }]).numberingIssues, []);
});
