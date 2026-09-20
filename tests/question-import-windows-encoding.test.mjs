import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

test("Windows upload keeps Chinese names under a GBK console and sends explicit UTF-8 JSON", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
  const source = readFileSync(new URL("../scripts/import-question-docx.mjs", import.meta.url), "utf8");
  const template = source.match(/const request = payload\s+\? `([^`]+)`/)[1];
  assert.match(source, /Buffer\.from\(payload, "utf8"\)\.toString\("base64"\)/);
  const fixture = { name: "2026万维定心卷道德与法治", file: { name: "题卷(1).pdf", base64: "Zml4dHVyZQ==" } };
  let received, contentType;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8")); contentType = request.headers["content-type"];
    response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const command = new Function("escapedUrl", "escapedOperation", `return \`${template}\`;`)(`http://127.0.0.1:${server.address().port}/import`, "encoding-fixture");
    await new Promise((resolve, reject) => {
      const child = spawn("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::InputEncoding=[System.Text.Encoding]::GetEncoding(936);${command}`], { env: { ...process.env, ZHISHI_IMPORT_TOKEN: "fixture-token" }, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; }); child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
      child.stdin.end(Buffer.from(JSON.stringify(fixture), "utf8").toString("base64"));
    });
    assert.deepEqual(received, fixture); assert.match(contentType, /charset=utf-8/i);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
