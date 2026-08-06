import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const reportPath = path.join(root, "outputs", "api-inventory.json");
const strict = process.argv.includes("--strict");
const apiDir = path.join(root, "app", "api");
const testDir = path.join(root, "tests");
const scriptDir = path.join(root, "scripts");
const referenceScripts = [
  "mini-automation.mjs",
  "mini-production-guard-e2e.mjs",
  "reproduce-runtime-issues.mjs",
  "surface-audit.mjs",
  "teaching-loop-e2e.mjs",
];
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

async function collectRouteFiles(dir) {
  const files = [];
  const walk = async (current, prefix) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}/${entry.name}`);
      else if (entry.name === "route.ts") {
        files.push({ file: `app/api${prefix}/route.ts`, full });
      }
    }
  };
  await walk(dir, "");
  return files;
}

function extractMethods(source) {
  const found = [];
  for (const method of methods) {
    const exportPatterns = [
      new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+)?${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\s*=`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ];
    if (exportPatterns.some((pattern) => pattern.test(source))) found.push(method);
  }
  return found;
}

function routePathFromFile(file) {
  const suffix = file.slice("app/api".length, -"/route.ts".length);
  return `/api${suffix}`;
}

async function collectReferenceSources() {
  const files = [];
  const tests = [];
  try {
    tests.push(...(await readdir(testDir)).filter((name) => name.endsWith(".test.mjs")));
  } catch {}
  for (const name of tests) files.push(path.join(testDir, name));
  for (const name of referenceScripts) {
    const file = path.join(scriptDir, name);
    try {
      await readFile(file);
      files.push(file);
    } catch {}
  }
  return Promise.all(
    files.map(async (file) => ({
      file: path.relative(root, file).replace(/\\/g, "/"),
      source: await readFile(file, "utf8"),
    })),
  );
}

async function collectAppSources() {
  const files = [];
  const walk = async (dir) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "api") continue;
        await walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        files.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  };
  await walk(path.join(root, "app"));
  return Promise.all(
    files.map(async (file) => ({
      file,
      source: await readFile(path.join(root, file), "utf8"),
    })),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function urlReferencePattern(routePath) {
  const parts = routePath.split("/").map((segment) => {
    if (/^\[[^\]]+\]$/.test(segment)) return "[^/\"'`\\s?#]*";
    return escapeRegExp(segment);
  });
  const methodSuffix = "(?:/(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD))?";
  const boundary = '(?=["\'`\\s?#]|$)';
  return new RegExp(parts.join("/") + methodSuffix + boundary, "g");
}

function collectReferences(route, sources) {
  const references = [];
  const urlPattern = urlReferencePattern(route.path);
  for (const source of sources) {
    const fileMatch = source.source.includes(route.file);
    const urlMatches = source.source.match(urlPattern) || [];
    const count = urlMatches.length + (fileMatch ? 1 : 0);
    if (count > 0) references.push({ source: source.file, filePath: fileMatch, urlMatches: urlMatches.length });
  }
  return references;
}

function summarize(routes) {
  const methodCounts = {};
  for (const method of methods) methodCounts[method] = 0;
  for (const route of routes) {
    for (const method of route.methods) methodCounts[method] = (methodCounts[method] || 0) + 1;
  }
  return {
    totalRoutes: routes.length,
    coveredRoutes: routes.filter((route) => route.references.length > 0).length,
    uncoveredRoutes: routes.filter((route) => route.references.length === 0).length,
    appOnlyRoutes: routes.filter(
      (route) => route.references.length === 0 && route.appReferences.length > 0,
    ).length,
    methodCounts,
  };
}

async function main() {
  const routeFiles = await collectRouteFiles(apiDir);
  const sources = await collectReferenceSources();
  const appSources = await collectAppSources();
  const routes = await Promise.all(
    routeFiles
      .map(({ file }) => ({
        file,
        full: path.join(root, file.replace(/\//g, path.sep)),
      }))
      .map(async ({ file, full }) => {
        const source = await readFile(full, "utf8");
        const route = {
          file,
          path: routePathFromFile(file),
          methods: extractMethods(source),
        };
        return route;
      }),
  );
  for (const route of routes) {
    route.references = collectReferences(route, sources);
    route.appReferences = collectReferences(route, appSources).map((item) => item.source);
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));

  const summary = summarize(routes);
  const uncovered = routes
    .filter((route) => route.references.length === 0)
    .map(({ file, path: routePath, methods: routeMethods }) => ({
      file,
      path: routePath,
      methods: routeMethods,
    }))
    .map((route) => {
      const full = routes.find((item) => item.path === route.path && item.file === route.file);
      return { ...route, appReferences: full?.appReferences || [] };
    });
  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    uncovered,
    routes,
    referenceSources: sources.map((source) => source.file),
    appSources: appSources.map((source) => source.file),
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`API 清单与测试引用（${report.generatedAt}）`);
  console.log(
    `${summary.totalRoutes} 个 API：${summary.coveredRoutes} 有测试/脚本引用，${summary.uncoveredRoutes} 未覆盖`,
  );
  console.log(`其中 ${summary.appOnlyRoutes} 个仅被页面调用、尚无测试/脚本引用`);
  console.log(
    `方法分布：${methods.map((method) => `${method}=${summary.methodCounts[method] || 0}`).join(" ")}`,
  );
  if (uncovered.length) {
    console.log("未覆盖路由：");
    for (const route of uncovered) {
      const usage = route.appReferences.length ? `页面调用：${route.appReferences.join(", ")}` : "无任何引用";
      console.log(`- ${route.path}（${route.methods.join("/") || "无导出方法"}）${usage}`);
    }
  }
  console.log(`报告：${path.relative(root, reportPath)}`);
  if (strict && uncovered.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
