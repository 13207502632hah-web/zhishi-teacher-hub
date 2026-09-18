import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const args = process.argv.slice(2);
const valueOf = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ""; };
const filePath = resolve(valueOf("--file") || "");
const baseUrl = String(valueOf("--base-url") || process.env.QUESTION_IMPORT_BASE_URL || "https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site").replace(/\/$/, "");
const token = String(process.env.QUESTION_IMPORT_AUTOMATION_TOKEN || "").trim();
if (!valueOf("--file")) throw new Error("请使用 --file 指定一份题库文件");
if (!token) throw new Error("缺少 QUESTION_IMPORT_AUTOMATION_TOKEN");

const bytes = await readFile(filePath);
const sourceFingerprint = createHash("sha256").update(bytes).digest("hex");
const headers = { Authorization: `Bearer ${token}` };
const readJson = async (response) => {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(String(body.error || `接口请求失败（HTTP ${response.status}）`));
  return body;
};

const preflight = await readJson(await fetch(`${baseUrl}/api/v2/questions/imports/automation?sourceFingerprint=${sourceFingerprint}`, { headers }));
if (preflight.existing) {
  console.log(JSON.stringify({ status: "skipped", reason: "source_already_imported", sourceFingerprint, existing: preflight.existing }, null, 2));
  process.exit(0);
}

const form = new FormData();
form.append("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), basename(filePath));
form.append("name", basename(filePath).replace(/\.[^.]+$/, ""));
const created = await readJson(await fetch(`${baseUrl}/api/v2/questions/imports/automation`, {
  method: "POST",
  headers: { ...headers, "X-Operation-Id": `question-import:${sourceFingerprint}` },
  body: form,
}));
const jobId = String(created.job?.id || "");
if (!jobId) throw new Error("导入接口没有返回任务编号");

const terminal = new Set(["completed", "failed", "cancelled", "partial"]);
const deadline = Date.now() + 10 * 60 * 1000;
let result;
while (Date.now() < deadline) {
  result = await readJson(await fetch(`${baseUrl}/api/v2/questions/imports/automation?id=${encodeURIComponent(jobId)}`, { headers }));
  if (terminal.has(String(result.job?.state || ""))) break;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
}
if (!result || !terminal.has(String(result.job?.state || ""))) throw new Error(`导入任务 ${jobId} 在十分钟内未结束`);
console.log(JSON.stringify({ sourceFingerprint, jobId, state: result.job.state, stage: result.job.stage, error: result.job.error, questionSet: result.questionSet, questions: result.questions }, null, 2));
if (result.job.state !== "completed") process.exitCode = 1;
