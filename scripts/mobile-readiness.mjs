#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_DIR = path.join(ROOT, ".artifacts", "mobile");
const strictExternal = process.argv.includes("--strict-external");

function source(relative) {
  const target = path.join(ROOT, relative);
  return existsSync(target) ? readFileSync(target, "utf8") : "";
}

function present(relative) { return existsSync(path.join(ROOT, relative)); }
function envHttps(name) {
  try {
    const url = new URL(process.env[name] || "");
    return url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname);
  } catch { return false; }
}

const local = [];
const external = [];
const addLocal = (name, pass, detail) => local.push({ name, pass: Boolean(pass), detail });
const addExternal = (name, ready, detail) => external.push({ name, ready: Boolean(ready), detail });

const manifest = source("public/manifest.webmanifest");
const worker = source("public/sw.js");
const pwaRegister = source("app/components/PwaRegister.tsx");
const webRecord = source("app/v2/record/RecordWorkspace.tsx");
addLocal("PWA 安装入口", present("app/install/page.tsx") && /manifest\.webmanifest/.test(source("app/layout.tsx")) && /display/.test(manifest), "包含安装页、Web App 清单和独立显示模式");
addLocal("PWA 离线恢复", present("public/offline-record.html") && /offline-record\.html/.test(worker) && /serviceWorker\.register/.test(pwaRegister), "Service Worker 提供离线记录兜底页");
addLocal("网页移动记录闭环", /baseVersion/.test(webRecord) && /编辑/.test(webRecord) && /CONFLICTS/.test(webRecord) && /share/.test(webRecord) && /DELETE/.test(webRecord), "支持新增、编辑、删除、共享审批、离线队列与版本冲突保留");

const iosRequired = ["APIClient.swift", "AppSession.swift", "Models.swift", "RecordStore.swift", "RecordListView.swift", "DashboardView.swift", "SettingsView.swift", "PrivacyInfo.xcprivacy"];
const iosClient = source("ios/ZhishiMobile/APIClient.swift");
const iosStore = source("ios/ZhishiMobile/RecordStore.swift");
const iosList = source("ios/ZhishiMobile/RecordListView.swift");
const iosPrivacy = source("ios/ZhishiMobile/PrivacyInfo.xcprivacy");
const iosProject = source("ios/project.yml");
addLocal("iOS 工程骨架", iosRequired.every((name) => present(`ios/ZhishiMobile/${name}`)) && present("ios/project.yml"), "iOS 17+ SwiftUI 与 XcodeGen 工程定义完整");
addLocal("iOS 连接安全", /scheme\?\.lowercased\(\) == "https"/.test(iosClient) && /components\.user == nil/.test(iosClient) && /NSAllowsArbitraryLoads: false/.test(iosProject), "只接受无账号、查询参数和片段的 HTTPS 工作室地址");
addLocal("iOS 离线与冲突", /flushOutbox/.test(iosStore) && /keepConflict/.test(iosStore) && /saveConflictAsCopy/.test(iosStore) && /editing\(record\)/.test(iosList), "支持离线续传、编辑和跨设备冲突另存");
addLocal("iOS 审批与删除", /requestShare/.test(iosStore) && /RecordDeleteResponse/.test(iosStore) && /提交共享确认|共享/.test(iosList), "正式共享仍进入教师待确认中心");
addLocal("Apple 隐私清单", /NSPrivacyTracking/.test(iosPrivacy) && /NSPrivacyAccessedAPICategoryUserDefaults/.test(iosPrivacy) && /CA92\.1/.test(iosPrivacy), "声明不跟踪、账号/用户内容用途与 UserDefaults 原因");

const miniApp = JSON.parse(source("mini-program/app.json") || "{}");
const miniProject = JSON.parse(source("mini-program/project.config.json") || "{}");
const miniConfig = source("mini-program/config.js");
const releaseTarget = JSON.parse(source("release-target.json") || "{}");
const releaseTargetSource = source("mini-program/release-target.js");
const allowedPages = new Set(["pages/home/index", "pages/dictation/index", "pages/class-files/index", "pages/notices/index", "pages/assignment/index", "pages/submit/index", "pages/bind/index", "pages/portal/index", "pages/excellent/index"]);
const registeredPages = Array.isArray(miniApp.pages) ? miniApp.pages : [];
const miniPageSources = registeredPages.map((page) => source(`mini-program/${page}.js`)).join("\n");
const miniApi = source("mini-program/utils/api.js");
addLocal("小程序角色边界", registeredPages.length === allowedPages.size && registeredPages.every((page) => allowedPages.has(page)), "构建只注册学生/家长页面，教师工具文件不会进入可访问路由");
addLocal("小程序 V2 数据接口", /\/api\/v2\/mini\//.test(miniPageSources) && /\/api\/v2\/mini\//.test(miniApi) && !/v2Path|replace\(\/\^\\\/api\\\/mini/.test(miniApi), "页面和共享请求层直接使用 /api/v2/mini，不保留旧接口转换层");
const releaseOriginSafe = /^https:\/\//.test(String(releaseTarget.apiOrigin || ""))
  && (releaseTarget.rootDomain ? !/\.invalid(?:\/|$)/i.test(releaseTarget.apiOrigin) : /\.invalid(?:\/|$)/i.test(releaseTarget.apiOrigin));
addLocal("小程序正式配置安全", miniProject.setting?.urlCheck === true && /releaseTarget\.apiOrigin/.test(miniConfig) && /configured:/.test(releaseTargetSource) && releaseOriginSafe, "开启合法域名检查，未配置正式域名时不会误连旧站");
addLocal("三端统一域名源", /RELEASE_METADATA_BASE/.test(source("app/layout.tsx")) && /releaseTarget\.apiOrigin/.test(miniConfig) && /ReleaseTarget\.apiBaseURL/.test(source("ios/ZhishiMobile/ZhishiMobileApp.swift")), "一次填写根域名后同步网站、小程序和 iOS 默认地址");

const migration = source("drizzle/0030_mobile_records_and_sync.sql");
addLocal("三端共享数据契约", present("app/api/v2/mobile/records/route.ts") && present("app/api/v2/mini/sync/route.ts") && /v2_mobile_records/.test(migration) && /v2_mobile_record_changes/.test(migration), "网页/iOS 使用共享记录，小程序只消费确认后的同步事件");
addLocal("私有文件鉴权", present("app/api/v2/mini/files/[id]/route.ts") && /mini/i.test(source("app/api/v2/mini/files/[id]/route.ts")), "小程序附件通过服务端鉴权接口读取");

const appIconDir = path.join(ROOT, "ios", "ZhishiMobile", "Assets.xcassets", "AppIcon.appiconset");
const iconReady = existsSync(appIconDir) && readdirSync(appIconDir).some((name) => /\.(png|jpe?g)$/i.test(name));
const configuredOrigin = String(releaseTarget.webOrigin || "");
const mainlandDomainReady = Boolean(releaseTarget.rootDomain) && /^https:\/\//.test(configuredOrigin) && !/chatgpt\.site|\.invalid(?:\/|$)/i.test(configuredOrigin);
let liveDomainReady = false;
try {
  const liveReport = JSON.parse(source(".artifacts/release/live-readiness.json") || "{}");
  liveDomainReady = liveReport.origin === configuredOrigin && liveReport.liveReady === true;
} catch { liveDomainReady = false; }
addExternal("三端自有域名配置", mainlandDomainReady || envHttps("MINI_STAGING_API_BASE"), "网站、小程序与 iOS 已统一使用自有 HTTPS 地址");
addExternal("正式域名可访问", liveDomainReady, "先运行 npm run release:live:check，再完成中国大陆多网络实测");
addExternal("微信正式账号与密钥", /^wx[a-f0-9]{16}$/i.test(process.env.MINI_APP_ID || miniProject.appid || "") && Boolean(process.env.WECHAT_APP_SECRET), "AppID 可在工程配置，AppSecret 必须仅保存在托管平台 Secret");
addExternal("微信开发者工具 CLI", Boolean(process.env.WECHAT_DEVTOOLS_CLI) && existsSync(process.env.WECHAT_DEVTOOLS_CLI), "用于生成体验版二维码和自动化模拟器验收");
addExternal("微信真机矩阵", process.env.MINI_DEVICE_ACCEPTANCE === "PASSED", "至少 2 台 Android、2 台 iPhone、1 台平板并记录弱网结果");
addExternal("Mac、Xcode 与签名 Team", process.platform === "darwin" && Boolean(process.env.IOS_DEVELOPMENT_TEAM), "Windows 无法完成 iOS 编译、签名和真机安装");
addExternal("iOS AppIcon", iconReady, "需要 1024×1024 正式图标并补入 AppIcon 资源目录");
addExternal("TestFlight 真机验收", process.env.IOS_TESTFLIGHT_ACCEPTANCE === "PASSED", "需在 Mac 上归档并由内部测试成员完成真机验收");

const localReady = local.every((item) => item.pass);
const externalReady = external.every((item) => item.ready);
const report = {
  generatedAt: new Date().toISOString(),
  scope: "知师研室网页 PWA、iOS 教师端、微信学生/家长端",
  localReady,
  externalReady,
  productionReady: localReady && externalReady,
  strictExternal,
  local,
  external,
  boundaries: { deployed: false, wechatUploaded: false, appStoreSubmitted: false, realDeviceTestedByThisCommand: false },
};

mkdirSync(ARTIFACT_DIR, { recursive: true });
writeFileSync(path.join(ARTIFACT_DIR, "readiness.json"), `${JSON.stringify(report, null, 2)}\n`);
const mark = (value) => value ? "✅" : "⬜";
const markdown = [
  "# 知师研室移动端就绪报告",
  "",
  `生成时间：${report.generatedAt}`,
  "",
  `本地实现：${localReady ? "通过" : "未通过"}；外部交付条件：${externalReady ? "已齐备" : "待准备"}；生产就绪：${report.productionReady ? "是" : "否"}`,
  "",
  "## 本地实现",
  "",
  ...local.map((item) => `- ${mark(item.pass)} ${item.name}：${item.detail}`),
  "",
  "## 外部条件",
  "",
  ...external.map((item) => `- ${mark(item.ready)} ${item.name}：${item.detail}`),
  "",
  "> 本命令只检查并生成证据，不会部署网站、上传微信版本、提交 App Store 或声称完成真机验收。",
  "",
].join("\n");
writeFileSync(path.join(ARTIFACT_DIR, "readiness.md"), markdown);

for (const item of local) console.log(`${mark(item.pass)} ${item.name}`);
for (const item of external) console.log(`${mark(item.ready)} ${item.name}（外部条件）`);
console.log(`报告：${path.relative(ROOT, path.join(ARTIFACT_DIR, "readiness.md"))}`);
if (!localReady || strictExternal && !externalReady) process.exitCode = 1;
