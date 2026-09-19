import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const valueOf = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ""; };
const filePath = resolve(valueOf("--file") || "");
const answerFilePath = valueOf("--answer-file") ? resolve(valueOf("--answer-file")) : "";
const importName = valueOf("--name") || basename(filePath).replace(/\.[^.]+$/, "");
const baseUrl = String(valueOf("--base-url") || process.env.QUESTION_IMPORT_BASE_URL || "https://daofazuoye.cn").replace(/\/$/, "");
const token = String(process.env.QUESTION_IMPORT_AUTOMATION_TOKEN || "").trim();
if (!valueOf("--file")) throw new Error("请使用 --file 指定一份题库文件");
if (!token) throw new Error("缺少 QUESTION_IMPORT_AUTOMATION_TOKEN");

const bytes = await readFile(filePath);
const answerBytes = answerFilePath ? await readFile(answerFilePath) : null;
const runCommand = (command, commandArgs) => new Promise((resolveCommand, rejectCommand) => {
  const child = spawn(command, commandArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectCommand); child.on("close", (code) => code === 0 ? resolveCommand() : rejectCommand(new Error(stderr || `${command} 执行失败（${code}）`)));
});
async function renderPdfPages(path, label) {
  if (extname(path).toLowerCase() !== ".pdf") return [];
  const directory = await mkdtemp(join(tmpdir(), "zhishi-pdf-pages-")), prefix = join(directory, label);
  try {
    await runCommand("pdftoppm", ["-jpeg", "-r", "144", "-jpegopt", "quality=82", path, prefix]);
    const names = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".jpg")).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
    if (!names.length || names.length > 40) throw new Error("PDF 页数须为 1 至 40 页");
    return Promise.all(names.map(async (name, index) => ({ name: `${label}-第${index + 1}页.jpg`, type: "image/jpeg", base64: (await readFile(join(directory, name))).toString("base64") })));
  } catch (reason) {
    throw new Error(`PDF 自动逐页转换失败：${reason instanceof Error ? reason.message : "请改用网页导入"}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const [questionPages, answerPages] = await Promise.all([
  renderPdfPages(filePath, "题卷"),
  answerFilePath ? renderPdfPages(answerFilePath, "答案") : Promise.resolve([]),
]);
const fileFingerprint = createHash("sha256").update(bytes).digest("hex");
const answerFingerprint = answerBytes ? createHash("sha256").update(answerBytes).digest("hex") : "";
const sourceFingerprint = answerFingerprint
  ? createHash("sha256").update(`${fileFingerprint}:${answerFingerprint}`).digest("hex")
  : fileFingerprint;
const headers = { Authorization: `Bearer ${token}` };
const mimeType = (path) => ({
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}[extname(path).toLowerCase()] || "application/octet-stream");
const readJson = async (response) => {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(String(body.error || `接口请求失败（HTTP ${response.status}）`));
  return body;
};

const encodedPayload = () => JSON.stringify({
  name: importName,
  file: { name: basename(filePath), type: mimeType(filePath), base64: bytes.toString("base64") },
  answerFile: answerBytes ? { name: basename(answerFilePath), type: mimeType(answerFilePath), base64: answerBytes.toString("base64") } : undefined,
  pages: questionPages,
  answerPages,
});

async function runPowerShell(command, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      env: { ...process.env, ZHISHI_IMPORT_TOKEN: token },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `PowerShell 请求失败（${code}）`)));
    child.stdin.end(input);
  });
}

async function requestJson(url, { method = "GET", operationId = "", upload = false } = {}) {
  const payload = upload ? encodedPayload() : undefined;
  if (process.platform !== "win32") {
    return readJson(await fetch(url, {
      method,
      headers: { ...headers, ...(payload ? { "Content-Type": "application/json" } : {}), ...(operationId ? { "X-Operation-Id": operationId } : {}) },
      body: payload,
    }));
  }

  const escapedUrl = url.replaceAll("'", "''"), escapedOperation = operationId.replaceAll("'", "''");
  const request = payload
    ? `$body=[Console]::In.ReadToEnd();$r=Invoke-WebRequest -Uri '${escapedUrl}' -Method Post -Headers @{Authorization=('Bearer '+$env:ZHISHI_IMPORT_TOKEN);Accept='application/json';'X-Operation-Id'='${escapedOperation}'} -ContentType 'application/json' -Body $body -SkipHttpErrorCheck`
    : `$r=Invoke-WebRequest -Uri '${escapedUrl}' -Headers @{Authorization=('Bearer '+$env:ZHISHI_IMPORT_TOKEN);Accept='application/json'} -SkipHttpErrorCheck`;
  const envelope = `${request};[ordered]@{status=[int]$r.StatusCode;contentType=[string]$r.Headers.'Content-Type';body=[string]$r.Content}|ConvertTo-Json -Compress`;
  const stdout = await runPowerShell(envelope, payload || "");
  const response = JSON.parse(String(stdout).trim());
  let body;
  try { body = JSON.parse(response.body); } catch { throw new Error(`接口返回了非 JSON 内容（HTTP ${response.status}）`); }
  if (response.status < 200 || response.status >= 300) throw new Error(String(body.error || `接口请求失败（HTTP ${response.status}）`));
  return body;
}

const preflight = await requestJson(`${baseUrl}/api/v2/questions/imports/automation?sourceFingerprint=${sourceFingerprint}`);
if (preflight.existing) {
  console.log(JSON.stringify({ status: "skipped", reason: "source_already_imported", sourceFingerprint, existing: preflight.existing }, null, 2));
  process.exit(0);
}

const baseOperationId = `question-import:${sourceFingerprint}`;
let created = await requestJson(`${baseUrl}/api/v2/questions/imports/automation`, {
  method: "POST",
  operationId: baseOperationId,
  upload: true,
});
if (["failed", "partial", "cancelled"].includes(String(created.job?.state || ""))) {
  created = await requestJson(`${baseUrl}/api/v2/questions/imports/automation`, {
    method: "POST",
    operationId: `${baseOperationId}:retry:${Date.now().toString(36)}`,
    upload: true,
  });
}
const jobId = String(created.job?.id || "");
if (!jobId) throw new Error("导入接口没有返回任务编号");

const terminal = new Set(["completed", "failed", "cancelled", "partial"]);
const deadline = Date.now() + 10 * 60 * 1000;
let result;
while (Date.now() < deadline) {
  result = await requestJson(`${baseUrl}/api/v2/questions/imports/automation?id=${encodeURIComponent(jobId)}`);
  if (terminal.has(String(result.job?.state || ""))) break;
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
}
if (!result || !terminal.has(String(result.job?.state || ""))) throw new Error(`导入任务 ${jobId} 在十分钟内未结束`);
console.log(JSON.stringify({ sourceFingerprint, jobId, state: result.job.state, stage: result.job.stage, error: result.job.error, questionSet: result.questionSet, recognized: result.job.result?.recognized, imported: result.job.result?.imported, pairedAnswerCoverage: result.job.result?.pairedAnswerCoverage }, null, 2));
if (result.job.state !== "completed") process.exitCode = 1;
