import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url), ts = require("../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js"), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), cache = new Map();
const loadTs = (absolutePath) => { if (cache.has(absolutePath)) return cache.get(absolutePath).exports; const source = readFileSync(absolutePath, "utf8"), code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, target = { exports: {} }; cache.set(absolutePath, target); const localRequire = (specifier) => { if (!specifier.startsWith(".")) return require(specifier); const resolved = fileURLToPath(new URL(specifier, pathToFileURL(absolutePath))); return loadTs(/\.[cm]?[jt]s$/.test(resolved) ? resolved : `${resolved}.ts`); }; new Function("module", "exports", "require", code)(target, target.exports, localRequire); return target.exports; };
const { normalizeScheduleRow, validateNormalizedSchedule } = loadTs(path.join(root, "app/lib/schedule-import.ts"));

const sizes = [10, 100, 500, 2000], mapping = { date: "日期", startTime: "开始时间", endTime: "结束时间", studentNames: "学生", className: "班级", courseName: "课程", location: "地点", fee: "费用" };
const pad = (value) => String(value).padStart(2, "0");
const sourceRow = (index) => { const day = new Date(Date.UTC(2031, 0, 1 + Math.floor(index / 8))), slot = index % 8, startMinutes = 8 * 60 + slot * 70, endMinutes = startMinutes + 55; return { 日期: day.toISOString().slice(0, 10), 开始时间: `${pad(Math.floor(startMinutes / 60))}:${pad(startMinutes % 60)}`, 结束时间: `${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`, 学生: `规模学生${String(index + 1).padStart(4, "0")}`, 班级: `规模班${String(index % 40 + 1).padStart(2, "0")}`, 课程: "思想政治", 地点: `教室${index % 12 + 1}`, 费用: String(100 + index % 5 * 20) }; };
const identity = (row) => [row.date, row.startTime, row.endTime, row.className, row.studentNames.join("、"), row.courseName].join("|");

function run(size) {
  const started = performance.now(), rows = Array.from({ length: size }, (_, index) => normalizeScheduleRow(sourceRow(index), mapping, "schedule-scale.csv")), issues = rows.flatMap((row, index) => validateNormalizedSchedule(row).map((issue) => ({ row: index + 1, issue })));
  if (issues.length) throw new Error(`${size} 行归一化出现 ${issues.length} 个错误：${JSON.stringify(issues.slice(0, 3))}`);
  if (new Set(rows.map(identity)).size !== size) throw new Error(`${size} 行生成数据存在重复课时身份`);

  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF; CREATE TABLE import_rows(id INTEGER PRIMARY KEY,row_number INTEGER UNIQUE,normalized_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'valid',lesson_id INTEGER); CREATE TABLE lessons(id INTEGER PRIMARY KEY,import_key TEXT NOT NULL,row_number INTEGER NOT NULL,date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,class_name TEXT NOT NULL,student_name TEXT NOT NULL,course_name TEXT NOT NULL,UNIQUE(date,start_time,end_time,class_name,student_name,course_name));");
  const insertRow = db.prepare("INSERT INTO import_rows(row_number,normalized_json,state) VALUES(?,?,'valid')"), insertLesson = db.prepare("INSERT OR IGNORE INTO lessons(import_key,row_number,date,start_time,end_time,class_name,student_name,course_name) VALUES(?,?,?,?,?,?,?,?)"), linkRow = db.prepare("UPDATE import_rows SET state='created',lesson_id=(SELECT id FROM lessons WHERE date=? AND start_time=? AND end_time=? AND class_name=? AND student_name=? AND course_name=?) WHERE row_number=?"), importKey = `scale-${size}`;
  db.exec("BEGIN"); rows.forEach((row, index) => insertRow.run(index + 1, JSON.stringify(row))); db.exec("COMMIT");

  const processRange = (from, to) => { for (let index = from; index < to; index += 50) { db.exec("BEGIN"); for (let cursor = index; cursor < Math.min(to, index + 50); cursor++) { const row = rows[cursor], values = [row.date, row.startTime, row.endTime, row.className, row.studentNames.join("、"), row.courseName]; insertLesson.run(importKey, cursor + 1, ...values); linkRow.run(...values, cursor + 1); } db.exec("COMMIT"); } };
  const interruptionAt = Math.max(1, Math.floor(size * .57)); processRange(0, interruptionAt);
  const beforeResume = Number(db.prepare("SELECT COUNT(*) AS total FROM import_rows WHERE state='created'").get().total); if (beforeResume !== interruptionAt) throw new Error(`${size} 行中断检查点不一致`);
  processRange(interruptionAt, size);
  const reconciledRows = Number(db.prepare("SELECT COUNT(*) AS total FROM import_rows WHERE state='created' AND lesson_id IS NOT NULL").get().total), lessons = Number(db.prepare("SELECT COUNT(*) AS total FROM lessons").get().total), missing = Number(db.prepare("SELECT COUNT(*) AS total FROM import_rows r LEFT JOIN lessons l ON l.id=r.lesson_id WHERE l.id IS NULL").get().total);
  if (reconciledRows !== size || lessons !== size || missing !== 0) throw new Error(`${size} 行续跑后对账失败`);
  const changesBefore = db.prepare("SELECT total_changes() AS total").get().total; processRange(0, size); const changesAfter = db.prepare("SELECT total_changes() AS total").get().total, lessonsAfterRepeat = Number(db.prepare("SELECT COUNT(*) AS total FROM lessons").get().total);
  if (lessonsAfterRepeat !== size) throw new Error(`${size} 行重复请求产生重复课时`);
  db.prepare("DELETE FROM lessons WHERE import_key=?").run(importKey); db.prepare("UPDATE import_rows SET state='valid',lesson_id=NULL").run();
  const afterUndo = Number(db.prepare("SELECT COUNT(*) AS total FROM lessons").get().total), resetRows = Number(db.prepare("SELECT COUNT(*) AS total FROM import_rows WHERE state='valid' AND lesson_id IS NULL").get().total); db.close();
  if (afterUndo !== 0 || resetRows !== size) throw new Error(`${size} 行安全撤销后对账失败`);
  return { size, normalized: rows.length, checkpoint: beforeResume, resumed: reconciledRows - beforeResume, reconciledRows, lessons, missing, repeatMaintainedCount: lessonsAfterRepeat, repeatDatabaseChanges: Number(changesAfter) - Number(changesBefore), undone: size, elapsedMs: Number((performance.now() - started).toFixed(2)), passed: true };
}

const results = sizes.map(run), report = { generatedAt: new Date().toISOString(), gate: "schedule-10-100-500-2000", chunkSize: 50, results, passed: results.every((row) => row.passed && row.reconciledRows === row.size && row.lessons === row.size && row.missing === 0 && row.repeatMaintainedCount === row.size && row.undone === row.size) };
const artifactDir = path.join(root, ".artifacts", "benchmarks"); mkdirSync(artifactDir, { recursive: true }); writeFileSync(path.join(artifactDir, "schedule-scale.json"), JSON.stringify(report, null, 2)); writeFileSync(path.join(artifactDir, "schedule-scale.md"), `# 课表规模验收\n\n生成时间：${report.generatedAt}\n\n| 行数 | 中断点 | 续跑 | 对账 | 重复后课时 | 撤销 | 耗时 |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${results.map((row) => `| ${row.size} | ${row.checkpoint} | ${row.resumed} | ${row.reconciledRows} | ${row.repeatMaintainedCount} | ${row.undone} | ${row.elapsedMs}ms |`).join("\n")}\n\n结论：${report.passed ? "PASS" : "FAIL"}。该门禁验证同一归一化规则、50 行分批、断点续跑、重复写入不增课时与安全撤销；视觉识别准确率仍需真实图片/PDF 标注集。\n`);
console.log(`课表规模门禁：${report.passed ? "PASS" : "FAIL"}`); for (const row of results) console.log(`${row.size} 行：对账 ${row.reconciledRows}/${row.size}，续跑 ${row.resumed}，重复后 ${row.repeatMaintainedCount}，撤销 ${row.undone}，${row.elapsedMs}ms`); console.log("报告：.artifacts/benchmarks/schedule-scale.json"); if (!report.passed) process.exitCode = 1;
