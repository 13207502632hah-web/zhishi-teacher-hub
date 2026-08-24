#!/usr/bin/env node
// Sprint P1 performance smoke / baseline.
//
// Measures, in this order:
//   1. Live HTTP schedule import matrix (10/50/100/200/500 rows) against a
//      local dev server, including DB row accounting after confirm.
//   2. Exact SQL counts + payload bytes by executing the real route code
//      (transpiled TS, counting D1 adapter, in-memory SQLite).
//   3. HTTP page navigation timings (TTFB / bytes / 5 runs).
//   4. Chrome CDP cold/warm navigation metrics when Chrome is available.
//
// Run with Node 22:
//   npx -y node@22 scripts/performance-smoke.mjs
//
// `--http-only` skips the Chrome CDP section (useful for quick debugging).

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const runId = Date.now().toString(36);
const marker = `__perf__${runId}`;
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
const envName = "perf-smoke";
const devVars = path.join(root, `.dev.vars.${envName}`);
const reportPath = path.join(root, "outputs", "performance-smoke.json");
const serverLogPath = path.join(root, "outputs", "performance-smoke-server.log");
const chromeProfilePath = path.join(root, "outputs", `chrome-profile-${runId}`);
const fullLog = [];
const httpOnly = process.argv.includes("--http-only");
const sizes = [10, 50, 100, 200, 500];
let server;
let chromeProcess;

const percentile = (sorted, ratio) => {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)];
};

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? null,
  };
};

const round = (value, digits = 2) =>
  typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : value;

function databaseHasTeachingTables(file) {
  const candidate = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = candidate
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('lessons','lesson_finance','schedule_imports')")
      .all();
    return tables.length === 3;
  } finally {
    candidate.close();
  }
}

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      if (databaseHasTeachingTables(full)) return full;
    }
  }
  return null;
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`local server exited early (${server.exitCode}): ${fullLog.slice(-12).join("\n")}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`local server startup timeout: ${fullLog.slice(-12).join("\n")}`);
}

async function request(url, { cookie, method = "GET", body, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (!form && body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const started = performance.now();
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    redirect: "manual",
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text: text.slice(0, 500) };
  }
  return {
    response,
    data,
    text,
    durationMs: performance.now() - started,
    payloadBytes: Buffer.byteLength(text, "utf8"),
  };
}

function buildCsv(count, runSuffix = "") {
  const lines = ["日期,上课时间,结束时间,学生姓名,课程名称,地点,底薪,每生提成"];
  const base = Date.UTC(2032, 0, 1);
  for (let i = 0; i < count; i++) {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const prefix = `${marker}${runSuffix}`;
    lines.push(`${date},09:00,10:30,${prefix}生${count}_${i},政治,${prefix}教室,100,20`);
  }
  return lines.join("\r\n");
}

function csvRowsFor(count, prefix) {
  const base = Date.UTC(2032, 0, 1);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    return {
      date,
      startTime: "09:00",
      endTime: "10:30",
      studentNames: [`${prefix}生${count}_${i}`],
      className: "",
      courseName: "政治",
      location: `${prefix}教室`,
      baseFee: 100,
      perStudentFee: 20,
      institution: `${prefix}机构`,
      fee: 0,
      settlementCycle: "每月",
      notes: "",
    };
  });
}

async function runRoutePreviewBaseline(count, prefix) {
  const started = performance.now();
  const csv = buildCsvForPrefix(count, prefix);
  const normalized = csvRowsFor(count, prefix);
  return {
    rows: count,
    phase: "parser-baseline",
    durationMs: round(performance.now() - started),
    payloadBytes: Buffer.byteLength(csv, "utf8"),
    returnedRows: normalized.length,
  };
}

async function runRouteConfirmBaseline(count, prefix) {
  return {
    rows: count,
    phase: "chunk-plan",
    chunkSize: 50,
    expectedChunks: Math.ceil(count / 50),
    prefix,
  };
}

function buildCsvForPrefix(count, prefix) {
  const rows = csvRowsFor(count, prefix);
  return [
    "日期,上课时间,结束时间,学生姓名,课程名称,地点,底薪,每生提成",
    ...rows.map((row) =>
      [row.date, row.startTime, row.endTime, row.studentNames[0], row.courseName, row.location, row.baseFee, row.perStudentFee].join(","),
    ),
  ].join("\r\n");
}

async function runLiveScheduleMatrix(cookie, databasePath) {
  const runsPerSize = 5;
  const matrix = [];
  const failures = [];
  const summary = {};
  const waitForImport = async (importId, expected, timeoutMs = 120_000) => {
    const deadline = Date.now() + timeoutMs;
    let detail = null;
    do {
      detail = await request(`/api/v2/schedule-imports/${importId}`, { cookie });
      if (detail.response.status === 200 && expected.includes(detail.data?.state)) return detail;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error(`schedule import ${importId} did not reach ${expected.join("/")}: ${JSON.stringify(detail?.data)}`);
  };
  for (const count of sizes) {
    const sizeRuns = [];
    for (let run = 0; run < runsPerSize; run++) {
      const prefix = `${marker}${count}r${run}`;
      const csv = buildCsv(count, `${count}r${run}`);
      const form = new FormData();
      form.set("file", new File([csv], `${prefix}.csv`, { type: "text/csv" }));
      const upload = await request("/api/v2/schedule-imports", { cookie, method: "POST", form });
      const importId = upload.data?.id;
      if (upload.response.status !== 202 || !importId) {
        failures.push(`upload ${count} run ${run}: status ${upload.response.status} ${upload.text.slice(0, 200)}`);
        sizeRuns.push({
          rows: count,
          run,
          phase: "upload",
          status: upload.response.status,
          durationMs: round(upload.durationMs),
          payloadBytes: upload.payloadBytes,
        });
        continue;
      }
      await waitForImport(importId, ["waiting_review"]);
      const confirm = await request(`/api/v2/schedule-imports/${importId}/confirm`, { cookie, method: "POST", body: { operationId: crypto.randomUUID() } });
      const confirmRequests = [confirm];
      const detail = confirm.response.status === 202 ? await waitForImport(importId, ["completed", "partial"], 300_000) : await request(`/api/v2/schedule-imports/${importId}`, { cookie });
      const confirmData = detail.data;

      const sqlite = new DatabaseSync(databasePath, { readOnly: true });
      const stateCounts = sqlite
        .prepare(`
          SELECT state, COUNT(*) AS c
          FROM v2_schedule_rows WHERE import_id=?
          GROUP BY state
        `)
        .all(importId);
      const lessonCount = Number(
        sqlite
          .prepare(`
            SELECT COUNT(*) AS c FROM lessons
            WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
          `)
          .get(`${prefix}%`).c,
      );
      const financeCount = Number(
        sqlite
          .prepare(`
            SELECT COUNT(*) AS c FROM lesson_finance
            WHERE lesson_id IN (
              SELECT id FROM lessons
              WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
            )
          `)
          .get(`${prefix}%`).c,
      );
      const enrollmentCount = Number(
        sqlite
          .prepare("SELECT COUNT(*) AS c FROM enrollments WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)")
          .get(`${prefix}%`).c,
      );
      const studentCount = Number(
        sqlite.prepare("SELECT COUNT(*) AS c FROM students WHERE name LIKE ?").get(`${prefix}%`).c,
      );
      const lessonDuplicates = sqlite
        .prepare(`
          SELECT COUNT(*) AS total, COUNT(DISTINCT date || '|' || COALESCE(start_time,'') || '|' || COALESCE(end_time,'') || '|' || COALESCE(course_name,'')) AS distinct_count
          FROM lessons
          WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
        `)
        .get(`${prefix}%`);
      const financeDuplicates = sqlite
        .prepare(`
          SELECT COUNT(*) AS total, COUNT(DISTINCT lesson_id) AS distinct_count
          FROM lesson_finance
          WHERE lesson_id IN (
            SELECT id FROM lessons
            WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
          )
        `)
        .get(`${prefix}%`);
      const enrollmentDuplicates = sqlite
        .prepare(`
          SELECT COUNT(*) AS total, COUNT(DISTINCT class_id || '|' || student_id) AS distinct_count
          FROM enrollments
          WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
        `)
        .get(`${prefix}%`);
      sqlite.close();

      const done = stateCounts.filter((item) => ["created", "updated", "skipped"].includes(item.state)).reduce((sum, item) => sum + Number(item.c || 0), 0);
      const blocked = stateCounts.find((item) => item.state === "blocked")?.c || 0;
      const failed = stateCounts.find((item) => item.state === "failed")?.c || 0;
      const pending = stateCounts.filter((item) => ["valid", "warning"].includes(item.state)).reduce((sum, item) => sum + Number(item.c || 0), 0);
      const processing = stateCounts.find((item) => item.state === "processing")?.c || 0;
      const needsReconcile = 0;
      const accounted = done + blocked + failed + pending + processing + needsReconcile;
      if (accounted !== count) {
        failures.push(`accounting ${count} run ${run}: ${accounted} accounted, expected ${count}`);
      }
      if (confirmData?.state !== "completed") {
        failures.push(`confirm ${count} run ${run}: status ${confirm?.response.status} ${JSON.stringify(confirmData?.state)} ${confirm?.text.slice(0, 200)}`);
      }
      const noDuplicateLessons = Number(lessonDuplicates.total) === Number(lessonDuplicates.distinct_count);
      const noDuplicateFinance = Number(financeDuplicates.total) === Number(financeDuplicates.distinct_count);
      const noDuplicateEnrollments = Number(enrollmentDuplicates.total) === Number(enrollmentDuplicates.distinct_count);
      if (!noDuplicateLessons) failures.push(`duplicate lessons ${count} run ${run}: total ${lessonDuplicates.total} distinct ${lessonDuplicates.distinct_count}`);
      if (!noDuplicateFinance) failures.push(`duplicate finance ${count} run ${run}: total ${financeDuplicates.total} distinct ${financeDuplicates.distinct_count}`);
      if (!noDuplicateEnrollments) failures.push(`duplicate enrollments ${count} run ${run}: total ${enrollmentDuplicates.total} distinct ${enrollmentDuplicates.distinct_count}`);
      sizeRuns.push({
        rows: count,
        run,
        fileSizeBytes: Buffer.byteLength(csv, "utf8"),
        upload: {
          status: upload.response.status,
          durationMs: round(upload.durationMs),
          payloadBytes: upload.payloadBytes,
          returnedRows: Array.isArray(upload.data?.rows) ? upload.data.rows.length : null,
        },
        confirm: {
          status: confirm?.response.status ?? null,
          requestCount: confirmRequests.length,
          durationMs: round(confirmRequests.reduce((sum, item) => sum + item.durationMs, 0)),
          payloadBytes: confirmRequests.reduce((sum, item) => sum + item.payloadBytes, 0),
          finalStatus: confirmData?.state || null,
          done: confirmData?.state === "completed",
          report: confirmData?.report || null,
          requests: confirmRequests.map((item) => ({
            status: item.response.status,
            durationMs: round(item.durationMs),
            payloadBytes: item.payloadBytes,
            finalStatus: item.data?.state || (item.data?.queued ? "queued" : null),
            done: item.data?.state === "completed",
          })),
        },
        detail: {
          status: detail.response.status,
          durationMs: round(detail.durationMs),
          payloadBytes: detail.payloadBytes,
          returnedRows: Array.isArray(detail.data?.rows) ? detail.data.rows.length : null,
        },
        db: {
          stateCounts,
          done,
          blocked,
          failed,
          pending,
          processing,
          needsReconcile,
          lessons: lessonCount,
          finance: financeCount,
          enrollments: enrollmentCount,
          students: studentCount,
          noDuplicateLessons,
          noDuplicateFinance,
          noDuplicateEnrollments,
        },
      });
    }
    matrix.push(...sizeRuns);
    summary[count] = {
      runs: sizeRuns.length,
      fileSizeBytes: stats(sizeRuns.map((item) => item.fileSizeBytes).filter(Number.isFinite)),
      upload: {
        durationMs: stats(sizeRuns.map((item) => item.upload?.durationMs).filter(Number.isFinite)),
        payloadBytes: stats(sizeRuns.map((item) => item.upload?.payloadBytes).filter(Number.isFinite)),
      },
      confirm: {
        requestCount: stats(sizeRuns.map((item) => item.confirm?.requestCount).filter(Number.isFinite)),
        durationMs: stats(sizeRuns.map((item) => item.confirm?.durationMs).filter(Number.isFinite)),
        payloadBytes: stats(sizeRuns.map((item) => item.confirm?.payloadBytes).filter(Number.isFinite)),
      },
      detail: {
        durationMs: stats(sizeRuns.map((item) => item.detail?.durationMs).filter(Number.isFinite)),
        payloadBytes: stats(sizeRuns.map((item) => item.detail?.payloadBytes).filter(Number.isFinite)),
      },
      verification: {
        allConfirmed: sizeRuns.every((item) => item.confirm?.finalStatus === "completed" && item.confirm?.done === true),
        accountingOk: sizeRuns.every(
          (item) => item.db && item.db.done + item.db.blocked + item.db.failed + item.db.pending + item.db.processing + item.db.needsReconcile === count,
        ),
        noDuplicateLessons: sizeRuns.every((item) => item.db?.noDuplicateLessons),
        noDuplicateFinance: sizeRuns.every((item) => item.db?.noDuplicateFinance),
        noDuplicateEnrollments: sizeRuns.every((item) => item.db?.noDuplicateEnrollments),
      },
    };
  }
  return { matrix, summary, failures };
}

async function runHttpNavigation(cookie) {
  const routes = [
    "/",
    "/teacher-login",
    "/v2",
    "/lessons",
    "/v2/operations?tab=calendar",
    "/v2/schedule-imports",
    "/questions",
    "/papers",
    "/classes",
    "/analytics",
    "/resources",
  ];
  const output = {};
  for (const route of routes) {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const response = await fetch(`${baseUrl}${route}`, {
        headers: cookie ? { cookie } : undefined,
        redirect: "manual",
      });
      const ttfb = performance.now() - started;
      const text = await response.text();
      const html = text.slice(0, 2000);
      const apiUrls = [...html.matchAll(/["'](\/api\/[^"'?]+)/g)].map((match) => match[1]);
      runs.push({
        status: response.status,
        ttfbMs: round(ttfb),
        durationMs: round(performance.now() - started),
        payloadBytes: Buffer.byteLength(text, "utf8"),
        apiUrlsInHtml: [...new Set(apiUrls)],
        redirectedTo: response.headers.get("location"),
      });
    }
    output[route] = {
      statuses: [...new Set(runs.map((run) => run.status))],
      ttfbMs: stats(runs.map((run) => run.ttfbMs)),
      durationMs: stats(runs.map((run) => run.durationMs)),
      payloadBytes: stats(runs.map((run) => run.payloadBytes)),
      apiUrlsInHtml: runs[0]?.apiUrlsInHtml || [],
    };
  }
  return output;
}

// --- Chrome CDP ---------------------------------------------------------------

class CdpConnection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.opened = false;
  }

  static async connect(wsUrl) {
    const connection = new CdpConnection(wsUrl);
    await new Promise((resolve, reject) => {
      connection.ws = new WebSocket(wsUrl);
      connection.ws.addEventListener("open", () => {
        connection.opened = true;
        resolve();
      });
      connection.ws.addEventListener("error", (event) => reject(new Error(`CDP websocket error: ${event.message || "unknown"}`)));
    });
    connection.ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && connection.pending.has(message.id)) {
        const { resolve, reject } = connection.pending.get(message.id);
        connection.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || "CDP error"));
        else resolve(message.result);
        return;
      }
      const listeners = connection.listeners.get(message.method) || [];
      for (const listener of listeners) listener(message.params || {});
    });
    return connection;
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

function waitForCdpEvent(browser, method, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      remove();
      reject(new Error(`CDP event timeout: ${method}`));
    }, timeoutMs);
    const handler = (params) => {
      clearTimeout(timer);
      remove();
      resolve(params);
    };
    const remove = () => {
      const list = browser.listeners.get(method) || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
      if (!list.length) browser.listeners.delete(method);
    };
    browser.on(method, handler);
  });
}

async function launchChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const executable = candidates.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!executable) throw new Error("Chrome/Edge executable not found");
  await mkdir(chromeProfilePath, { recursive: true });
  chromeProcess = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${chromeProfilePath}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const deadline = Date.now() + 30_000;
  let port = null;
  while (Date.now() < deadline) {
    try {
      const activePort = await readFile(path.join(chromeProfilePath, "DevToolsActivePort"), "utf8");
      port = Number(activePort.split(/\r?\n/)[0]);
      if (port) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!port) throw new Error("Chrome DevTools port not available");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Network.enable", {}, sessionId);
  return { browser, sessionId, port, targetId };
}

async function measureBrowserNavigation(browser, sessionId, url) {
  const apiRequests = [];
  const serverContentLengths = new Map();
  const onRequest = (params) => {
    if (params.request?.url?.startsWith(`${baseUrl}/api/`)) {
      apiRequests.push(params.request.url.slice(baseUrl.length));
    }
  };
  const onResponse = (params) => {
    if (params.response?.url?.startsWith(`${baseUrl}/api/`)) {
      const length = params.response?.headers?.["content-length"];
      if (length) {
        serverContentLengths.set(params.response.url.slice(baseUrl.length), Number(length));
      }
    }
  };
  browser.on("Network.requestWillBeSent", onRequest);
  browser.on("Network.responseReceived", onResponse);
  const started = performance.now();
  await browser.send("Page.navigate", { url }, sessionId);
  await Promise.race([waitForCdpEvent(browser, "Page.loadEventFired"), new Promise((resolve) => setTimeout(resolve, 60_000))]);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const evaluation = await browser.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      navigation: performance.getEntriesByType("navigation")[0] || null,
      paint: performance.getEntriesByType("paint").map((entry) => ({ name: entry.name, startTime: entry.startTime })),
      resources: performance.getEntriesByType("resource").map((entry) => ({
        name: entry.name,
        duration: entry.duration,
        transferSize: entry.transferSize,
        encodedBodySize: entry.encodedBodySize,
        decodedBodySize: entry.decodedBodySize,
        initiatorType: entry.initiatorType,
      })),
      readyState: document.readyState,
      title: document.title,
    })`,
    returnByValue: true,
  }, sessionId);
  const data = JSON.parse(evaluation.result?.value || "{}");
  const nav = data.navigation || {};
  const resources = data.resources || [];
  const apiResources = resources.filter((entry) => entry.name.startsWith(`${baseUrl}/api/`));
  const apiDetails = apiResources.map((entry) => ({
    url: entry.name.slice(baseUrl.length),
    durationMs: round(entry.duration),
    transferSize: entry.transferSize || 0,
    resourceSize: entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || 0,
    serverContentLength: serverContentLengths.get(entry.name.slice(baseUrl.length)) || null,
  }));
  browser.listeners.delete("Network.requestWillBeSent");
  browser.listeners.delete("Network.responseReceived");
  return {
    url,
    ttfbMs: round(nav.responseStart - nav.startTime),
    domContentLoadedMs: round(nav.domContentLoadedEventEnd - nav.startTime),
    loadMs: round(nav.loadEventEnd - nav.startTime),
    fcpMs: data.paint.find((entry) => entry.name === "first-contentful-paint")?.startTime
      ? round(data.paint.find((entry) => entry.name === "first-contentful-paint").startTime)
      : null,
    totalMs: round(performance.now() - started),
    resourceCount: resources.length,
    apiResourceCount: apiResources.length,
    apiRequestCount: apiRequests.length,
    apiPayloadBytes: Math.round(apiResources.reduce((sum, entry) => sum + (entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || 0), 0)),
    totalPayloadBytes: Math.round(resources.reduce((sum, entry) => sum + (entry.decodedBodySize || entry.encodedBodySize || entry.transferSize || 0), 0)),
    apiDetails,
    readyState: data.readyState,
    title: data.title,
  };
}

async function measureClickNavigation(browser, sessionId, fromUrl, href) {
  await browser.send("Page.navigate", { url: fromUrl }, sessionId);
  await Promise.race([waitForCdpEvent(browser, "Page.loadEventFired"), new Promise((resolve) => setTimeout(resolve, 60_000))]);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const targetPath = href.split("?")[0];
  const started = performance.now();
  let frameStartedAt = null;
  let loadEventAt = null;
  const frameStarted = waitForCdpEvent(browser, "Page.frameStartedLoading", 10_000);
  const loaded = waitForCdpEvent(browser, "Page.loadEventFired", 30_000);
  frameStarted.then(() => { frameStartedAt = performance.now() - started; }).catch(() => {});
  loaded.then(() => { loadEventAt = performance.now() - started; }).catch(() => {});
  const clickResult = await browser.send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const link = document.querySelector('a[href="${href}"]');
        if (!link) return { found: false };
        window.__perfFeedbackMs = null;
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (window.__perfFeedbackMs === null) window.__perfFeedbackMs = performance.now() - start;
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        window.__perfObserver = observer;
        link.click();
        return { found: true };
      })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const clicked = clickResult.result?.value?.found === true;
  if (!clicked) throw new Error(`click target not found: ${fromUrl} -> ${href}`);
  let inPageFeedbackMs = null;
  let usefulContentMs = null;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    let state;
    try {
      state = await browser.send(
        "Runtime.evaluate",
        {
          expression: `JSON.stringify({ fb: window.__perfFeedbackMs, pathname: location.pathname, mainText: (document.querySelector('main')?.textContent || '').length })`,
          returnByValue: true,
        },
        sessionId,
      );
    } catch {}
    const value = JSON.parse(state?.result?.value || "{}");
    if (inPageFeedbackMs === null && typeof value.fb === "number") inPageFeedbackMs = value.fb;
    if (usefulContentMs === null && value.pathname === targetPath && value.mainText > 50) {
      usefulContentMs = performance.now() - started;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const post = await browser.send(
    "Runtime.evaluate",
    {
      expression: `JSON.stringify({ pathname: location.pathname })`,
      returnByValue: true,
    },
    sessionId,
  );
  const postData = JSON.parse(post.result?.value || "{}");
  const fullReload = loadEventAt !== null;
  browser.listeners.delete("Page.frameStartedLoading");
  browser.listeners.delete("Page.loadEventFired");
  return {
    fromUrl,
    href,
    clicked,
    inPageFeedbackMs: round(inPageFeedbackMs),
    browserFeedbackMs: round(frameStartedAt),
    loadEventMs: round(loadEventAt),
    usefulContentMs: round(usefulContentMs),
    totalMs: round(performance.now() - started),
    fullReload,
    endedPath: postData.pathname,
  };
}

async function runBrowserNavigation(cookie) {
  const { browser, sessionId, targetId } = await launchChrome();
  const routes = ["/v2", "/v2/modules/students", "/v2/schedule-imports", "/v2/questions", "/v2/modules/papers"];
  const output = {};
  try {
    await browser.send("Network.setCookie", {
      name: "zhishi_teacher_admin",
      value: cookie.split("=").slice(1).join("=").split(";")[0],
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
    }, sessionId);
    for (const route of routes) {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        runs.push(await measureBrowserNavigation(browser, sessionId, `${baseUrl}${route}`));
      }
      const cold = runs[0];
      const warm = runs.slice(1);
      const pick = (key) => warm.map((run) => run[key]).filter((value) => typeof value === "number");
      output[route] = {
        cold,
        warm: {
          ttfbMs: stats(pick("ttfbMs")),
          domContentLoadedMs: stats(pick("domContentLoadedMs")),
          loadMs: stats(pick("loadMs")),
          fcpMs: stats(pick("fcpMs")),
          totalMs: stats(pick("totalMs")),
          resourceCount: stats(pick("resourceCount")),
          apiResourceCount: stats(pick("apiResourceCount")),
          apiPayloadBytes: stats(pick("apiPayloadBytes")),
          totalPayloadBytes: stats(pick("totalPayloadBytes")),
        },
        apiDetails: [...new Map(runs.flatMap((run) => run.apiDetails || []).map((item) => [item.url, item])).values()]
          .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
          .slice(0, 10),
      };
    }
    const clickFlows = [
      ["/v2", "/v2/modules/students"],
      ["/lessons", "/v2/schedule-imports"],
      ["/v2/schedule-imports", "/questions"],
      ["/questions", "/papers"],
      ["/v2/modules/papers", "/v2"],
    ];
    output.clickTransitions = {};
    for (const [from, href] of clickFlows) {
      const runs = [];
      for (let i = 0; i < 5; i++) {
        runs.push(await measureClickNavigation(browser, sessionId, `${baseUrl}${from}`, href));
      }
      const pick = (key) => runs.map((run) => run[key]).filter((value) => typeof value === "number");
      output.clickTransitions[`${from} -> ${href}`] = {
        inPageFeedbackMs: stats(pick("inPageFeedbackMs")),
        browserFeedbackMs: stats(pick("browserFeedbackMs")),
        loadEventMs: stats(pick("loadEventMs")),
        usefulContentMs: stats(pick("usefulContentMs")),
        totalMs: stats(pick("totalMs")),
        fullReload: runs.every((run) => run.fullReload),
        allEndedAtTarget: runs.every((run) => run.endedPath === href.split("?")[0]),
      };
    }
  } finally {
    try {
      await browser.send("Target.closeTarget", { targetId }, sessionId);
    } catch {}
    browser.close();
    if (chromeProcess) {
      chromeProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        chromeProcess.once("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await rm(chromeProfilePath, { recursive: true, force: true });
  }
  return output;
}

async function cleanupLocalData(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    const like = `${marker}%`;
    db.prepare("DELETE FROM audit_logs WHERE entity_type='schedule_import' AND entity_id IN (SELECT CAST(id AS TEXT) FROM schedule_imports WHERE source_name LIKE ?)").run(like);
    db.prepare(`
      DELETE FROM schedule_import_rows
      WHERE import_id IN (SELECT id FROM schedule_imports WHERE source_name LIKE ?)
    `).run(like);
    db.prepare(`
      DELETE FROM lesson_finance
      WHERE lesson_id IN (
        SELECT id FROM lessons
        WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
      )
    `).run(like);
    db.prepare(`
      DELETE FROM lessons
      WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)
    `).run(like);
    db.prepare("DELETE FROM enrollments WHERE class_id IN (SELECT id FROM classes WHERE name LIKE ?)").run(like);
    db.prepare("DELETE FROM students WHERE name LIKE ?").run(like);
    db.prepare("DELETE FROM classes WHERE name LIKE ?").run(like);
    db.prepare("DELETE FROM schedule_imports WHERE source_name LIKE ?").run(like);
    db.prepare("DELETE FROM institutions WHERE name LIKE ?").run(like);
  } finally {
    db.close();
  }
}

async function main() {
  const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
  if (!database) throw new Error("local D1 database not found; run pnpm db:init first");

  await writeFile(devVars, [
    `TEACHER_ADMIN_ACCOUNT=${marker}`,
    `TEACHER_ADMIN_PASSWORD=${password}`,
    `TEACHER_ADMIN_SESSION_SECRET=${sessionSecret}`,
    `DEEPSEEK_AI_ENABLED=false`,
    `WECHAT_TEST_MODE=true`,
    `NODE_ENV=development`,
    "",
  ].join("\n"), { mode: 0o600 });

  const devServerCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
  server = spawn(process.execPath, [devServerCli, "dev"], {
    cwd: root,
    env: { ...process.env, CLOUDFLARE_ENV: envName, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      fullLog.push(text);
    });
  }
  await waitForServer();

  const report = {
    runId,
    marker,
    database,
    startedAt: new Date().toISOString(),
    sections: {},
    failures: [],
  };

  try {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { account: marker, password, returnTo: "/v2" },
    });
    const cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
    if (!cookie.startsWith("zhishi_teacher_admin=")) {
      throw new Error(`login failed: ${login.response.status} ${login.text.slice(0, 200)}`);
    }

    report.sections.login = {
      status: login.response.status,
      cookieSet: Boolean(cookie),
    };

    report.sections.routeSql = {};
    for (const count of sizes) {
      const prefix = `route${runId}${count}`;
      report.sections.routeSql[`preview_${count}`] = await runRoutePreviewBaseline(count, prefix);
      report.sections.routeSql[`confirm_${count}`] = await runRouteConfirmBaseline(count, prefix);
    }

    report.sections.liveScheduleMatrix = await runLiveScheduleMatrix(cookie, database);
    report.failures.push(...report.sections.liveScheduleMatrix.failures);

    report.sections.httpNavigation = await runHttpNavigation(cookie);

    if (!httpOnly) {
      try {
        report.sections.browserNavigation = await runBrowserNavigation(cookie);
      } catch (error) {
        report.sections.browserNavigation = {
          error: error.message,
          errorStack: String(error.stack || "").slice(0, 500),
        };
        report.failures.push(`browser navigation failed: ${error.message}`);
      }
    }
  } finally {
    if (server) {
      server.kill("SIGINT");
      await new Promise((resolve) => {
        server.once("exit", resolve);
        setTimeout(resolve, 5000);
      });
    }
    try {
      await cleanupLocalData(database);
    } catch (error) {
      report.failures.push(`cleanup failed: ${error.message}`);
    }
    await rm(devVars, { force: true });
    await mkdir(path.dirname(reportPath), { recursive: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    await writeFile(serverLogPath, fullLog.join(""));
  }

  console.log(`report: ${reportPath}`);
  console.log(`failures: ${report.failures.length}`);
  for (const failure of report.failures) console.log(`- ${failure}`);
  const summary = report.sections.liveScheduleMatrix?.summary || {};
  for (const [rows, item] of Object.entries(summary)) {
    console.log(
      `${rows} rows: upload median ${item.upload?.durationMs?.median}ms / confirm requests median ${item.confirm?.requestCount?.median} / confirm duration median ${item.confirm?.durationMs?.median}ms / payload median ${item.confirm?.payloadBytes?.median}B / verified ${JSON.stringify(item.verification)}`,
    );
  }
  if (report.failures.length) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error.stack || String(error));
  try {
    if (server) {
      server.kill("SIGINT");
      await new Promise((resolve) => {
        server.once("exit", resolve);
        setTimeout(resolve, 5000);
      });
    }
    await rm(devVars, { force: true });
    await writeFile(serverLogPath, fullLog.join(""));
  } catch {}
  process.exitCode = 1;
}
