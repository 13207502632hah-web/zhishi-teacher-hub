#!/usr/bin/env node

import { promises as dns } from "node:dns";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_DIR = path.join(ROOT, ".artifacts", "release");
const strict = process.argv.includes("--strict");
const originArgument = process.argv.find((value) => value.startsWith("--origin="))?.slice("--origin=".length);
const apiOriginArgument = process.argv.find((value) => value.startsWith("--api-origin="))?.slice("--api-origin=".length);
const execFileAsync = promisify(execFile);

function configuredTargets() {
  const targetPath = path.join(ROOT, "release-target.json");
  if (!existsSync(targetPath)) throw new Error("缺少 release-target.json，请先运行 npm run release:domain -- your-domain.cn");
  const target = JSON.parse(readFileSync(targetPath, "utf8"));
  return {
    webOrigin: originArgument || target.webOrigin,
    apiOrigin: apiOriginArgument || target.apiOrigin,
  };
}

function normalizedOrigin(input) {
  const url = new URL(String(input || ""));
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.port) {
    throw new Error("正式入口必须是没有路径、查询参数和端口的 HTTPS 根地址");
  }
  return url;
}

async function resolveRecord(hostname, type) {
  try {
    const records = await dns.resolve(hostname, type);
    return { type, ready: records.length > 0, records, error: null };
  } catch (error) {
    const systemError = error instanceof Error ? error.code || error.message : String(error);
    try {
      const response = await fetch(`https://dns.alidns.com/resolve?name=${encodeURIComponent(hostname)}&type=${encodeURIComponent(type)}`, {
        signal: AbortSignal.timeout(8_000),
        headers: { accept: "application/dns-json", "user-agent": "ZhishiReleaseReadiness/2.0" },
      });
      const payload = await response.json();
      const records = Array.isArray(payload.Answer) ? payload.Answer.map((item) => item.data) : [];
      return { type, ready: payload.Status === 0 && records.length > 0, records, error: records.length ? null : systemError, source: "AliDNS DoH fallback" };
    } catch {
      return { type, ready: false, records: [], error: systemError };
    }
  }
}

async function requestWithSystemNetwork(url, options = {}) {
  const marker = "__ZHISHI_CURL_META__";
  const userAgent = options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36 ZhishiReleaseReadiness/2.0";
  const args = [
    "--silent", "--show-error", "--max-time", "15",
    "--request", options.method || "GET",
    "--header", `Accept: ${options.accept || "*/*"}`,
    "--header", `User-Agent: ${userAgent}`,
  ];
  if (options.redirect !== "manual") args.push("--location");
  if (options.body) args.push("--header", "Content-Type: application/json", "--data-raw", options.body);
  args.push("--write-out", `\n${marker}\n%{http_code}\n%{content_type}\n%{redirect_url}`, String(url));
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "curl.exe" : "curl", args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    const markerIndex = stdout.lastIndexOf(`\n${marker}\n`);
    if (markerIndex < 0) throw new Error("系统网络复核未返回状态信息");
    const body = stdout.slice(0, markerIndex);
    const [statusText = "", contentType = "", location = ""] = stdout.slice(markerIndex + marker.length + 2).split(/\r?\n/);
    return {
      reachable: true,
      status: Number(statusText),
      location: location || null,
      contentType: contentType || null,
      body: options.readBody ? body : "",
      error: null,
      transport: "system-network-fallback",
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      location: null,
      contentType: null,
      body: "",
      error: error instanceof Error ? error.message : String(error),
      transport: "system-network-fallback",
    };
  }
}

async function request(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      redirect: options.redirect || "follow",
      signal: AbortSignal.timeout(8_000),
      headers: {
        accept: options.accept || "*/*",
        ...(options.body ? { "content-type": "application/json" } : {}),
        "user-agent": options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36 ZhishiReleaseReadiness/2.0",
      },
      body: options.body,
    });
    const body = options.readBody ? await response.text() : "";
    const result = {
      reachable: true,
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      body,
      error: null,
    };
    // Cloudflare can challenge Node's TLS fingerprint while allowing the same
    // production request through the operating-system network stack. Recheck
    // only HTML challenges; business JSON requirements remain unchanged.
    if (result.status === 403 && /text\/html/i.test(result.contentType || "")) {
      return requestWithSystemNetwork(url, options);
    }
    return result;
  } catch (error) {
    return {
      reachable: false,
      status: null,
      location: null,
      contentType: null,
      body: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function evaluateReadiness({ dnsRecords, http, homepage, manifest, session, miniLogin }) {
  const addressReady = dnsRecords.some((item) => ["A", "AAAA", "CNAME"].includes(item.type) && item.ready);
  const nameserverReady = dnsRecords.some((item) => item.type === "NS" && item.ready);
  const httpRedirectReady = Boolean(http.reachable && [301, 302, 307, 308].includes(http.status) && /^https:\/\//i.test(http.location || ""));
  const httpsReady = Boolean(homepage.reachable && homepage.status >= 200 && homepage.status < 400);
  const manifestReady = Boolean(
    manifest.reachable
    && manifest.status === 200
    && /application\/(?:manifest\+json|json)/i.test(manifest.contentType || "")
    && /"(?:start_url|display)"\s*:/.test(manifest.body),
  );
  const apiReady = Boolean(
    session.reachable
    && [200, 401, 403].includes(session.status)
    && /application\/json/i.test(session.contentType || ""),
  );
  const miniLoginReady = Boolean(
    miniLogin?.reachable
    && [400, 401, 403].includes(miniLogin.status)
    && /application\/json/i.test(miniLogin.contentType || ""),
  );
  const challengeBlocked = [homepage, manifest, session, miniLogin].some((probe) => (
    probe?.reachable
    && probe.status === 403
    && /text\/html/i.test(probe.contentType || "")
  ));
  const checks = [
    { name: "权威 DNS", ready: nameserverReady, detail: "根域名存在 NS 记录" },
    { name: "网站地址记录", ready: addressReady, detail: "根域名存在 A、AAAA 或 CNAME 记录" },
    { name: "HTTP 强制 HTTPS", ready: httpRedirectReady, detail: "HTTP 入口跳转到 HTTPS" },
    { name: "HTTPS 首页", ready: httpsReady, detail: "首页证书有效且返回成功状态" },
    { name: "PWA 清单", ready: manifestReady, detail: "manifest.webmanifest 可访问且结构有效" },
    {
      name: "会话接口",
      ready: apiReady,
      detail: challengeBlocked
        ? "/api/session 被 HTML 安全挑战拦截；小程序和原生客户端无法完成此类挑战"
        : "/api/session 返回 JSON；未登录的 401/403 JSON 响应也视为接口在线",
    },
    {
      name: "小程序登录入口",
      ready: miniLoginReady,
      detail: miniLogin?.reachable && miniLogin.status === 403 && /text\/html/i.test(miniLogin.contentType || "")
        ? "/api/v2/mini/login 被 HTML 安全挑战拦截，微信客户端无法完成此类挑战"
        : "/api/v2/mini/login 返回 JSON，探测码被业务层安全拒绝即视为入口在线",
    },
  ];
  return { checks, liveReady: checks.every((item) => item.ready) };
}

async function main() {
  const targets = configuredTargets();
  const origin = normalizedOrigin(targets.webOrigin);
  const apiOrigin = normalizedOrigin(targets.apiOrigin);
  const hostname = origin.hostname;
  const dnsRecords = await Promise.all(["NS", "A", "AAAA", "CNAME"].map((type) => resolveRecord(hostname, type)));
  const [http, homepage, manifest, session, miniLogin] = await Promise.all([
    request(`http://${hostname}`, { redirect: "manual" }),
    request(origin.href, { accept: "text/html,application/xhtml+xml" }),
    request(new URL("/manifest.webmanifest", origin), { readBody: true, accept: "application/manifest+json,application/json" }),
    request(new URL("/api/session", origin), { accept: "application/json" }),
    request(new URL("/api/v2/mini/login", apiOrigin), {
      method: "POST",
      accept: "application/json",
      // Probe the route as the production caller does. Cloudflare may challenge
      // non-browser automation identifiers even when real WeChat requests reach the app.
      userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36 MicroMessenger/8.0.50 ZhishiReleaseReadiness/2.0",
      body: JSON.stringify({ code: "invalid-release-readiness-probe", role: "student" }),
    }),
  ]);
  const evaluation = evaluateReadiness({ dnsRecords, http, homepage, manifest, session, miniLogin });
  const report = {
    generatedAt: new Date().toISOString(),
    origin: origin.origin,
    apiOrigin: apiOrigin.origin,
    strict,
    ...evaluation,
    probes: { dns: dnsRecords, http, homepage, manifest: { ...manifest, body: manifest.body.slice(0, 1_000) }, session, miniLogin },
    boundaries: { dnsChanged: false, deployed: false, certificateIssued: false },
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, "live-readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
  const mark = (ready) => ready ? "✅" : "⬜";
  const markdown = [
    "# 正式域名上线体检",
    "",
    `生成时间：${report.generatedAt}`,
    `入口：\`${report.origin}\``,
    `小程序 API：\`${report.apiOrigin}\``,
    `结论：${report.liveReady ? "已具备三端联调条件" : "尚未具备三端联调条件"}`,
    "",
    ...report.checks.map((item) => `- ${mark(item.ready)} ${item.name}：${item.detail}`),
    "",
    "> 本命令只进行外部只读检查，不会修改 DNS、部署应用或签发证书。",
    "",
  ].join("\n");
  await writeFile(path.join(REPORT_DIR, "live-readiness.md"), markdown);

  for (const item of report.checks) console.log(`${mark(item.ready)} ${item.name}`);
  console.log(`报告：${path.relative(ROOT, path.join(REPORT_DIR, "live-readiness.md"))}`);
  if (strict && !report.liveReady) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`上线体检失败：${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
