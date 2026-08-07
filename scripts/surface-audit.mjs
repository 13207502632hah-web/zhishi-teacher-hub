import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const marker = "__surface_audit__";
const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(32).toString("base64url");
const devVars = path.join(root, ".dev.vars.surface-audit");
const reportPath = path.join(root, "outputs", "surface-audit.json");
const logs = [];
const results = [];
const anomalies = [];
const serverLogTail = [];
let server;

const ok = (status) => status >= 200 && status < 500 && status !== 401 && status !== 403 && status !== 500;

function record({ group, kind, method, url, status, expected, detail = "", authenticated = null }) {
  results.push({ group, kind, method, url, status, expected, detail, authenticated });
  if (expected && !expected.includes(status)) anomalies.push({ group, kind, method, url, status, expected, detail });
}

async function request(url, { cookie, bearer, method = "GET", body, formData } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const canHaveBody = !["GET", "HEAD"].includes(method);
  if (!formData && canHaveBody && body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers,
    body: canHaveBody ? formData ?? (body !== undefined ? JSON.stringify(body) : undefined) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 200) }; }
  return { response, data };
}

function databaseHasTeachingTables(file) {
  const candidate = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = candidate
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('lessons','lesson_finance')")
      .all();
    return tables.length === 2;
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
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`本地服务提前退出（code ${server.exitCode}）：${serverLogTail.slice(-10).join("\n")}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地服务启动超时：${serverLogTail.slice(-10).join("\n")}`);
}

async function collectPageRoutes() {
  const pages = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "api" || entry.name === "components" || entry.name === "lib") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}/${entry.name}`);
      else if (entry.name === "page.tsx") pages.push((prefix || "/") === "/" ? "/" : prefix);
    }
  };
  await walk(path.join(root, "app"), "");
  return pages;
}

async function collectApiRoutes() {
  const routes = [];
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}/${entry.name}`);
      else if (entry.name === "route.ts") routes.push(`${prefix}/route.ts`);
    }
  };
  await walk(path.join(root, "app", "api"), "/api");
  const miniOrder = (route) => {
    if (route === "/api/mini/logout") return 2;
    if (route.startsWith("/api/mini/")) return 1;
    return 0;
  };
  return routes
    .map((file) => file.replace(/\\/g, "/").replace(/\/route\.ts$/, ""))
    // Keep mini login/read routes before logout so the token session is still
    // alive when with-token probes run; logout must be the last mini call.
    .sort((a, b) => miniOrder(a) - miniOrder(b) || a.localeCompare(b));
}

const entityTable = {
  assessments: "assessments",
  assignments: "assignments",
  classes: "classes",
  "exam-projects": "exam_projects",
  feedback: "feedback",
  "feedback-imports": "feedback_imports",
  files: "file_assets",
  lessons: "lessons",
  papers: "papers",
  "question-views": "saved_question_views",
  "question-sets": "question_sets",
  questions: "questions",
  reflections: "reflections",
  resources: "resources",
  "schedule-imports": "schedule_imports",
  students: "students",
  "workflow-templates": "workflow_templates",
};

async function resolveRoutePath(route, db) {
  let resolved = route;
  const segments = route.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment.startsWith("[") || !segment.endsWith("]")) continue;
    const key = segment.slice(1, -1);
    let table = null;
    if (key === "year") {
      const year = db.prepare("SELECT name FROM academic_years ORDER BY id LIMIT 1").get();
      resolved = resolved.replace(`[year]`, year?.name || "2025-2026");
      continue;
    }
    if (key === "type") {
      resolved = resolved.replace("[type]", "lessons");
      continue;
    }
    if (key === "token") {
      resolved = resolved.replace("[token]", "surface-audit-invalid-token");
      continue;
    }
    if (key === "fileId") table = "file_assets";
    else if (key === "id") table = entityTable[segments[index - 1]];
    if (table) {
      const row = db.prepare(`SELECT id FROM ${table} ORDER BY id LIMIT 1`).get();
      resolved = resolved.replace(segment, row?.id ?? "1");
    } else {
      resolved = resolved.replace(segment, "1");
    }
  }
  return resolved;
}

const postPayloads = {
  "/api/assessments": {},
  "/api/assessments/1": { date: "2026-99-99" },
  "/api/assignments": { lessonId: 0, title: "" },
  "/api/auth/login": { account: marker, password },
  "/api/auth/logout": {},
  "/api/calendar/subscription": {},
  "/api/classes": { name: "" },
  "/api/exam-projects": { academicYear: "2025-2026" },
  "/api/feedback": {},
  "/api/feedback/templates": { name: "" },
  "/api/feedback-imports": { sourceText: "" },
  "/api/files": {},
  "/api/finance": {},
  "/api/finance/packages": {},
  "/api/lessons": { date: "not-a-date" },
  "/api/mini/login": { role: "teacher", testCode: "surface-audit" },
  "/api/papers": {},
  "/api/papers/upload": {},
  "/api/question-sets/import": { name: "", questions: [] },
  "/api/question-views": { name: "", filters: {} },
  "/api/questions": {},
  "/api/questions/batch": {},
  "/api/questions/portable": {},
  "/api/recognition": {},
  "/api/reflections": { date: "2026-99-99" },
  "/api/resources": { title: "" },
  "/api/schedule-imports": {},
  "/api/settings/ai": {},
  "/api/settings/demo": {},
  "/api/settings/data": { confirmation: "错误确认文字" },
  "/api/workflow-templates": { type: "next_plan", name: "" },
  "/api/ai/feedback-drafts": { lessonId: 0 },
  "/api/ai/lesson-prep": { lessonId: 0 },
  "/api/ai/paper-review": { paperId: 0 },
  "/api/ai/question-reviews": { questionIds: [] },
  "/api/ai/reflection-drafts": { lessonId: 0 },
  "/api/ai/schedule-reschedule": { lessonId: 0 },
  "/api/ai/wrong-question-remediation": { studentId: 0 },
  "/api/ai/question-reviews/apply": { reviewIds: [] },
};

const methodPayloads = {
  "/api/academic-years/[year]/promotion": { POST: { academicYear: "2025-2026" }, GET: null },
  "/api/assessments/1": { PUT: { date: "2026-99-99" } },
  "/api/classes/1": { PUT: { name: "" }, PATCH: { name: "" }, POST: { name: "" } },
  "/api/feedback/1": { PUT: { content: "" } },
  "/api/lessons/1": { PUT: { topic: "" } },
  "/api/lessons/1/activity": { GET: null, POST: {} },
  "/api/lessons/1/homework-draft": { POST: {} },
  "/api/lessons/1/prep": { PATCH: {}, GET: null },
  "/api/lessons/1/questions": { GET: null, POST: { questionIds: [] }, DELETE: {} },
  "/api/lessons/1/questions/batch": { POST: { questionIds: [] } },
  "/api/lessons/1/workflow-state": { GET: null, PUT: { revision: -1 } },
  "/api/questions/1": { GET: null, PUT: { stem: "" }, PATCH: { stem: "" } },
  "/api/reflections/1": { GET: null, PUT: { date: "2026-99-99" } },
  "/api/students/1": { PUT: { name: "" } },
  "/api/students/1/mastery": { GET: null, POST: {} },
  "/api/students/1/wrong-questions": { GET: null, POST: {}, PATCH: {}, DELETE: {} },
  "/api/exam-projects/1/results": { GET: null, PUT: {} },
  "/api/papers/1": { GET: null, POST: {}, PATCH: {}, DELETE: {} },
  "/api/papers/1/export-job": { GET: null, POST: {}, PUT: {}, PATCH: {} },
  "/api/feedback-imports/1": { GET: null, PATCH: {} },
  "/api/feedback-imports/1/confirm": { POST: {} },
  "/api/question-sets/1/confirm": { POST: {} },
  "/api/question-views/1": { DELETE: {} },
  "/api/resources/1": { DELETE: {} },
  "/api/schedule-imports/1/confirm": { POST: {} },
  "/api/settings": { POST: {} },
  "/api/workflow-templates/1": { GET: null, PUT: {}, DELETE: {} },
  "/api/audit": { POST: { entityType: "", action: "" } },
  "/api/auth/change-password": { POST: { currentPassword: "wrong", newPassword: "short" } },
  "/api/questions/1/review": { POST: {} },
  "/api/question-sets/source": { POST: {} },
  "/api/assignments/1/submissions": { GET: null, POST: {} },
  "/api/assignments/files": { POST: {} },
  "/api/papers/1/files": { GET: null, POST: {} },
  "/api/files/1": { GET: null },
  "/api/questions/1/content": { GET: null },
  "/api/questions/1/similar": { GET: null },
  "/api/students/1/insights": { GET: null },
  "/api/students/1/monthly-report": { GET: null },
  "/api/students/1/private": { GET: null },
  "/api/students/1/recommendations": { GET: null },
  "/api/students/1/score-trends": { GET: null },
  "/api/papers/1/files/1": { GET: null },
  "/api/mini/me/GET": null,
  "/api/mini/portal/GET": null,
  "/api/mini/logout/POST": {},
  "/api/mini/accounts/GET": null,
  "/api/mini/accounts/POST": {},
  "/api/mini/assignments/GET": null,
  "/api/mini/assignments/POST": {},
  "/api/mini/bind/POST": {},
  "/api/mini/bindings/1/POST": {},
  "/api/mini/classes/GET": null,
  "/api/mini/excellent/GET": null,
  "/api/mini/excellent/POST": {},
  "/api/mini/files/POST": {},
  "/api/mini/files/1/GET": null,
  "/api/mini/invites/GET": null,
  "/api/mini/invites/POST": {},
  "/api/mini/paper-files/1/GET": null,
  "/api/mini/submissions/GET": null,
  "/api/mini/submissions/POST": {},
  "/api/mini/sync/GET": null,
};

const skipAuthenticatedGet = new Set([
  "/api/exports/lessons",
  "/api/finance/export",
  "/api/settings/export",
  "/api/settings/demo",
  "/api/settings/data",
  "/api/reflections",
  "/api/auth/login",
  "/api/auth/logout",
]);

const publicRoutes = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/session",
  "/api/calendar/feed/invalid-token",
  "/api/calendar/feed/[token]",
  "/api/resources",
  "/api/mini/login",
]);

const multipartMethods = {
  "/api/assignments/files": new Set(["POST"]),
  "/api/files": new Set(["POST"]),
  "/api/papers/upload": new Set(["POST"]),
  "/api/question-sets/source": new Set(["POST"]),
  "/api/schedule-imports": new Set(["POST"]),
  "/api/papers/[id]/export-job": new Set(["PUT"]),
};

async function readRouteMethods(route) {
  const file = path.join(root, "app", ...route.split("/").filter(Boolean), "route.ts");
  const source = await readFile(file, "utf8");
  return [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g)].map((match) => match[1]);
}

async function probeRoute(route, db, cookie, miniToken) {
  const resolved = await resolveRoutePath(route, db);
  const isPublic = publicRoutes.has(resolved) || publicRoutes.has(route);
  const isMini = route.startsWith("/api/mini/");
  const isExport = route.includes("/exports/") || route === "/api/finance/export" || route === "/api/settings/export";
  const isDemoData = route === "/api/settings/demo" || route === "/api/settings/data";
  const methods = await readRouteMethods(route);

  if (isPublic) {
    if (route === "/api/auth/login") {
      const bad = await request(resolved, { method: "POST", body: {} });
      record({ group: "api-public", kind: "login-empty", method: "POST", url: resolved, status: bad.response.status, expected: [401] });
    } else if (route === "/api/auth/logout") {
      const out = await request(resolved, { method: "GET" });
      record({ group: "api-public", kind: "logout", method: "GET", url: resolved, status: out.response.status, expected: [303] });
    } else if (route === "/api/session") {
      const session = await request(resolved);
      record({ group: "api-public", kind: "session-anonymous", method: "GET", url: resolved, status: session.response.status, expected: [200] });
    } else if (route === "/api/calendar/feed/[token]") {
      const feed = await request(resolved);
      record({ group: "api-public", kind: "feed-invalid-token", method: "GET", url: resolved, status: feed.response.status, expected: [404] });
    } else if (route === "/api/resources") {
      const resource = await request(resolved);
      record({ group: "api-public", kind: "resources-anonymous", method: "GET", url: resolved, status: resource.response.status, expected: [200] });
    } else if (route === "/api/mini/login") {
      const mini = await request(resolved, { method: "POST", body: { role: "teacher", testCode: "surface-audit" } });
      record({ group: "api-mini", kind: "mini-login", method: "POST", url: resolved, status: mini.response.status, expected: [200], detail: mini.data?.token ? `token=${String(mini.data.token).slice(0, 8)}…` : JSON.stringify(mini.data).slice(0, 120) });
      if (mini.response.status === 200 && mini.data?.token) return mini.data.token;
    }
    return miniToken;
  }

  if (route === "/api/resources/[id]") {
    const anonymousGet = await request(resolved);
    record({ group: "api-public", kind: "resource-detail-anonymous", method: "GET", url: resolved, status: anonymousGet.response.status, expected: [200, 404] });
    const authenticatedGet = await request(resolved, { cookie });
    record({ group: "api-public", kind: "resource-detail-authenticated", method: "GET", url: resolved, status: authenticatedGet.response.status, expected: [200, 404] });
    const anonymousDelete = await request(resolved, { method: "DELETE" });
    record({ group: "api-private", kind: "resource-detail-delete-anonymous", method: "DELETE", url: resolved, status: anonymousDelete.response.status, expected: [401] });
    const authenticatedDelete = await request(resolved, { cookie, method: "DELETE" });
    record({ group: "api-private", kind: "resource-detail-delete-authenticated", method: "DELETE", url: resolved, status: authenticatedDelete.response.status, expected: [200, 400, 404, 422] });
    return miniToken;
  }

  if (isDemoData) {
    const noConfirm = await request(resolved, { cookie, method: "DELETE", body: { confirmation: "错误确认文字" } });
    record({ group: "api-private", kind: "delete-without-confirmation", method: "DELETE", url: resolved, status: noConfirm.response.status, expected: [400] });
    return miniToken;
  }

  if (isExport) {
    if (methods.includes("GET")) {
      const anonymous = await request(resolved);
      record({ group: "api-private", kind: "export-anonymous", method: "GET", url: resolved, status: anonymous.response.status, expected: [401] });
    }
    return miniToken;
  }

  if (isMini) {
    for (const method of methods) {
      const payloadKey = `${resolved}/${method}`;
      const body = methodPayloads[payloadKey];
      if (method === "GET" || body !== undefined) {
        const anonymous = await request(resolved, { method, body: body ?? {} });
        record({ group: "api-mini", kind: "anonymous", method, url: resolved, status: anonymous.response.status, expected: [401] });
        if (miniToken) {
          const withToken = await request(resolved, { bearer: miniToken, method, body: body ?? {} });
          record({ group: "api-mini", kind: "with-token", method, url: resolved, status: withToken.response.status, expected: [200, 201, 400, 403, 404, 422], detail: typeof withToken.data === "object" && withToken.data?.error ? String(withToken.data.error) : "" });
        }
      }
    }
    return miniToken;
  }

  for (const method of methods) {
    if (method === "GET" && (skipAuthenticatedGet.has(resolved) || skipAuthenticatedGet.has(route))) continue;
    if (method === "GET") {
      const anonymous = await request(resolved);
      record({ group: "api-private", kind: "anonymous", method, url: resolved, status: anonymous.response.status, expected: [401] });
      const getResult = await request(resolved, { cookie });
      record({
        group: "api-private",
        kind: "authenticated",
        method,
        url: resolved,
        status: getResult.response.status,
        expected: ok(getResult.response.status) ? [200, 201, 400, 404, 405, 409, 422] : [],
      });
      continue;
    }
    const payload = methodPayloads[`${resolved}/${method}`] ?? postPayloads[route] ?? {};
    const isMultipart = multipartMethods[route]?.has(method);
    const authResult = await request(resolved, {
      cookie,
      method,
      body: isMultipart ? undefined : payload,
      formData: isMultipart ? new FormData() : undefined,
    });
    record({
      group: "api-private",
      kind: "authenticated",
      method,
      url: resolved,
      status: authResult.response.status,
      expected: ok(authResult.response.status) ? (isMultipart ? [400, 404, 405, 409, 413, 415, 422] : [200, 201, 202, 204, 400, 404, 405, 409, 413, 422]) : [],
    });
  }

  return miniToken;
}

async function main() {
  const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
  if (!database) throw new Error("未找到本地 D1 数据库，请先运行 pnpm dev 初始化");
  const sqlite = new DatabaseSync(database, { readOnly: true });
  let cookie = "";
  try {
    await writeFile(devVars, [
      `TEACHER_ADMIN_ACCOUNT=${marker}`,
      `TEACHER_ADMIN_PASSWORD=${password}`,
      `TEACHER_ADMIN_SESSION_SECRET=${sessionSecret}`,
      `DEEPSEEK_AI_ENABLED=false`,
      `WECHAT_TEST_MODE=true`,
      `NODE_ENV=development`,
      ``,
    ].join("\n"), { mode: 0o600 });

    const devServerCli = path.join(root, "node_modules", "vinext", "dist", "cli.js");
    server = spawn(process.execPath, [devServerCli, "dev"], {
      cwd: root,
      env: { ...process.env, CLOUDFLARE_ENV: "surface-audit", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on("data", (chunk) => {
        const text = String(chunk);
        logs.push(text);
        serverLogTail.push(...text.split(/\r?\n/).filter(Boolean));
        if (serverLogTail.length > 200) serverLogTail.splice(0, serverLogTail.length - 200);
      });
    }
    await waitForServer();

    const login = await request("/api/auth/login", { method: "POST", body: { account: marker, password, returnTo: "/workspace" } });
    record({ group: "auth", kind: "login", method: "POST", url: "/api/auth/login", status: login.response.status, expected: [200] });
    cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
    if (!cookie.startsWith("zhishi_teacher_admin=")) anomalies.push({ group: "auth", kind: "login-cookie", method: "POST", url: "/api/auth/login", status: login.response.status, expected: [200], detail: "未获得教师会话 Cookie" });

    await request("/api/settings/demo", { cookie, method: "DELETE", body: { confirmation: "清除演示数据" } });
    const demo = await request("/api/settings/demo", { cookie, method: "POST", body: {} });
    record({ group: "demo", kind: "create-demo", method: "POST", url: "/api/settings/demo", status: demo.response.status, expected: [200, 201] });

    const pages = await collectPageRoutes();
    for (const page of pages) {
      const resolved = await resolveRoutePath(page, sqlite);
      const isPublicPage = page === "/" || page === "/teacher-login" || page === "/resources" || page === "/resources/[id]";
      const anon = await request(resolved);
      record({
        group: "page",
        kind: "anonymous",
        method: "GET",
        url: resolved,
        status: anon.response.status,
        expected: isPublicPage ? [200] : [302, 307, 308],
        detail: isPublicPage ? "" : anon.response.status === 200 ? "client-rendered（未服务端 gate，P1-03）" : "server-gated",
      });
      const auth = await request(resolved, { cookie });
      record({ group: "page", kind: "authenticated", method: "GET", url: resolved, status: auth.response.status, expected: [200, 302, 307, 404] });
    }

    const routes = await collectApiRoutes();
    let miniToken = null;
    for (const route of routes) miniToken = await probeRoute(route, sqlite, cookie, miniToken);

    const counts = sqlite.prepare(`
      SELECT
        (SELECT COUNT(*) FROM classes) AS classes,
        (SELECT COUNT(*) FROM students) AS students,
        (SELECT COUNT(*) FROM lessons) AS lessons,
        (SELECT COUNT(*) FROM questions) AS questions,
        (SELECT COUNT(*) FROM papers) AS papers,
        (SELECT COUNT(*) FROM feedback) AS feedback,
        (SELECT COUNT(*) FROM reflections) AS reflections,
        (SELECT COUNT(*) FROM assessments) AS assessments,
        (SELECT COUNT(*) FROM assessment_results) AS assessmentResults,
        (SELECT COUNT(*) FROM exam_projects) AS examProjects,
        (SELECT COUNT(*) FROM schedule_imports) AS scheduleImports,
        (SELECT COUNT(*) FROM recognition_jobs) AS recognitionJobs,
        (SELECT COUNT(*) FROM saved_question_views) AS savedQuestionViews,
        (SELECT COUNT(*) FROM file_assets) AS fileAssets,
        (SELECT COUNT(*) FROM feedback_imports) AS feedbackImports,
        (SELECT COUNT(*) FROM resources) AS resources,
        (SELECT COUNT(*) FROM settlement_items) AS settlementItems
    `).get();

    const unique = new Set(results.map((item) => `${item.group}:${item.kind}`));
    const report = {
      ok: anomalies.length === 0,
      generatedAt: new Date().toISOString(),
      scope: {
        pages: pages.length,
        apiRoutes: routes.length,
        checks: results.length,
        checkKinds: unique.size,
        demoCounts: counts,
      },
      anomalies,
      results,
      logs: logs.slice(-30),
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      ok: report.ok,
      pages: pages.length,
      apiRoutes: routes.length,
      checks: results.length,
      anomalies: anomalies.length,
      demo: counts,
      report: path.relative(root, reportPath),
    }, null, 2));
    if (anomalies.length) {
      console.log("发现异常：");
      for (const anomaly of anomalies.slice(0, 50)) console.log(`- ${anomaly.group}/${anomaly.kind} ${anomaly.method} ${anomaly.url} -> ${anomaly.status} (期望 ${anomaly.expected.join("/")})${anomaly.detail ? ` ${anomaly.detail}` : ""}`);
    }
  } finally {
    try {
      if (cookie) {
        const cleanup = await request("/api/settings/demo", { cookie, method: "DELETE", body: { confirmation: "清除演示数据" } });
        console.error(`demo cleanup -> ${cleanup.response.status} ${JSON.stringify(cleanup.data).slice(0, 200)}`);
      }
    } catch (error) {
      console.error(`demo cleanup failed -> ${String(error)}`);
    }
    sqlite.close();
    if (server && !server.killed) server.kill("SIGINT");
    await rm(devVars, { force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack || String(error));
  process.exitCode = 1;
}
