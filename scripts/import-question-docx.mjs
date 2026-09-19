import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

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

const created = await requestJson(`${baseUrl}/api/v2/questions/imports/automation`, {
  method: "POST",
  operationId: `question-import:${sourceFingerprint}`,
  upload: true,
});
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
