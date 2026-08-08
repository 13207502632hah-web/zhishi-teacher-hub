# Sprint P1 课表导入与站点性能收尾最终报告（2026-08-08）

> 范围：P1 性能与可靠性收尾，覆盖课表导入分块确认、确认幂等、预览/确认身份缓存、
> SPA 内部导航、真实确认进度与最终生产发布门禁。
> 原始证据：`outputs/performance-smoke.json`（runId `msker1x0`）、
> `outputs/gates-274a43f8bdad.json`、`outputs/scale-benchmark.json`、
> `docs/P1_PERFORMANCE_BASELINE.md`（父目录 docs）。

## 1. 版本与环境

- 仓库：`zhishi-teacher-hub`，分支 `main`
- 代码 SHA：`274a43f8bdad92414cb8fee043f605cf9a13c9e1`（= `origin/main`）
- Node：`v22.23.2`（`npx -y node@22`）
- 本地运行：`vinext dev` 端口 3000，本地 D1 SQLite，临时 teacher admin 登录
- 部署方式：Sites（Cloudflare Workers 兼容产物 + D1 `DB` + R2 `FILES`）

## 2. 结论摘要

```text
FIXED:      课表确认分块 done 语义、确认重放幂等、预览/确认身份缓存、
            客户端分块确认与真实进度、SPA 内部导航（不再整页刷新）
VERIFIED:   typecheck / lint / 346 tests / build / teaching E2E /
            surface audit / API audit / 性能 smoke 全 PASS
NOT_REPRODUCED: 本轮无新增可复现生产正确性问题
BLOCKED:    生产带认证 smoke（无 PROD_SMOKE_TEACHER 凭据，不覆盖生产 Secret、
            不放宽认证）；最终状态 READY FOR STAGING
```

## 3. 本轮修复内容

### 3.1 课表确认分块与 done 语义

`app/api/schedule-imports/[id]/confirm/route.ts`

- 新增 `CONFIRM_CHUNK_SIZE = 50`：claim 查询只取未完成且未在处理的
  `schedule_import_rows`，`LIMIT 50`，并排除 `processing_state='done'`。
- 已确认任务重放响应补上 `done: true`，与真实状态一致。
- 正常响应增加 `done`（`rows.length < 50 || finalStatus.status === "confirmed"`）
  与 `processed`（本次实际处理行数），客户端据此判断是否继续。
- 确认过程使用请求级 `ScheduleIdentityCache`，同一请求内 class / student /
  enrollment 集合查询不重复打库。

### 3.2 预览与确认身份缓存

- `app/lib/schedule-import-identity.ts`：新增 `ScheduleIdentityCache` 类型与
  `classCacheKey`；`findClassId` / `findStudentRecords` / `findLessonByIdentity` /
  `studentsMatchClass` 支持缓存，保持 workspace scope 与同名学生防护不变。
- `app/lib/schedule-import-preview.ts`、`app/api/schedule-imports/route.ts`：
  preview 阶段共用同一请求级缓存，消除逐行 N+1 查询。

### 3.3 客户端分块确认与真实进度

`app/schedule-imports/page.tsx`

- 新导入确认与历史任务重试都按 `MAX_CONFIRM_CHUNKS = 20` 循环调用 confirm，
  直到服务端 `done !== false`。
- 分块报告累加 `created / updated / skipped / blocked / studentsCreated`，
  最终展示真实剩余行数。
- 确认过程显示“已处理 N 行 · 成功 M · 待确认 K · 失败 L”的真实进度，不再
  只有静态文案。

### 3.4 SPA 内部导航

- `app/components/HardNavigationLink.tsx`：改用 Next.js `<Link>` 做 SPA 导航，
  保留 `prefetch` 语义；工作区主导航点击不再整页刷新。
- `app/components/WorkspaceNavigation.tsx`：退出登录保持原生 `<a>` 整页跳转，
  避免 SPA 拦截登出流程。
- `tests/rendered-html.test.mjs`：同步更新导航契约断言。

### 3.5 新增测试

- `tests/schedule-import-chunked.test.mjs`（新增 4 项）：
  120 行按 50 行分块且重放幂等、恰好 50 行单请求 `done=true`、请求级身份缓存
  复用、并发 confirm 只成功一次且其余返回 `409 retryLater`。

## 4. 性能 Before / After

### 4.1 页面 HTTP TTFB（5 次取中位数）

| Route | Before median (ms) | After median (ms) |
|---|---:|---:|
| `/` | 70.3 | 73.53 |
| `/teacher-login` | 64.3 | 49.17 |
| `/workspace` | 76.2 | 79.57 |
| `/lessons` | 74.2 | 59.42 |
| `/schedule-imports` | 73.6 | 62.56 |
| `/questions` | 81.9 | 75.04 |
| `/papers` | 78.8 | 75.87 |

页面 TTFB 在修复前后均正常（49–80ms），不是站点“慢”的来源。

### 4.2 主导航点击切换（5 次取中位数）

| 点击 | Before useful (ms) | After feedback (ms) | After useful (ms) | After total (ms) | Full reload |
|---|---:|---:|---:|---:|---|
| `/workspace` → `/lessons` | 171.3 | 63.9 | 69.67 | 377.54 | false |
| `/lessons` → `/schedule-imports` | 683.3 | 589.4 | 728.06 | 1040.6 | false |
| `/schedule-imports` → `/questions` | 176.3 | 46.6 | 91.6 | 406.48 | false |
| `/questions` → `/papers` | 159.1 | 74.7 | 86.4 | 391.46 | false |
| `/papers` → `/workspace` | 160.4 | 65.4 | 74.43 | 388.43 | false |

全部点击切换 `fullReload: false`、`allEndedAtTarget: true`；除
`/lessons → /schedule-imports`（受 `/api/classes` 本地基准数据影响）外，
useful content 从 150–180ms 量级降到 70–92ms。

### 4.3 课表导入规模矩阵（真实 HTTP，每规模 5 次）

全部规模 5/5 `allConfirmed`，无重复 lesson / finance / enrollment。

| Rows | Before confirm median (ms) | After upload median (ms) | After confirm requests | After confirm median (ms) | After confirm payload (B) |
|---:|---:|---:|---:|---:|---:|
| 10 | 449.6 | 112.47 | 1 | 339.85 | 925 |
| 50 | 1,963.6 | 283.54 | 1 | 1,472.86 | 4,005 |
| 100 | 3,947.0 | 522.4 | 2 | 2,830.52 | 15,664 |
| 200 | 7,957.8 | 1,003.11 | 4 | 5,803.54 | 62,330 |
| 500 | 19,936 | 2,599.53 | 10 | 14,887.73 | 388,328 |

### 4.4 Route 级 SQL / payload（内存 SQLite 直调真实 route）

| 场景 | After requests | After SQL | After read | After write | After payload (B) |
|---|---:|---:|---:|---:|---:|
| preview 10 | 1 | 33 | 22 | 11 | 7,382 |
| preview 50 | 1 | 153 | 102 | 51 | 34,902 |
| preview 100 | 1 | 303 | 202 | 101 | 70,308 |
| preview 200 | 1 | 603 | 402 | 201 | 140,608 |
| preview 500 | 1 | 1,503 | 1,002 | 501 | 351,508 |
| confirm 10 | 1 | 128 | 45 | 83 | 847 |
| confirm 50 | 1 | 608 | 205 | 403 | 3,687 |
| confirm 100 | 2 | 1,215 | 410 | 805 | 14,581 |
| confirm 200 | 4 | 2,429 | 820 | 1,609 | 58,915 |
| confirm 500 | 10 | 6,071 | 2,050 | 4,021 | 370,717 |

对比基线：preview 500 从 2,503 SQL 降至 1,503 SQL；confirm 500 从单请求
8,008 SQL（约 20s）改为 10 个请求、每请求最多 50 行，总 SQL 6,071，
HTTP 实测约 14.9s 且有真实进度。

### 4.5 题库规模（R1-04R 已封板，本轮无题库代码改动）

相似度两阶段（300 导入 refs，候选预算 2000）：

| scale | Before candidates / comparisons / ms / payload | After candidates / comparisons / ms / payload |
|---|---:|
| 1k | 1000 / 300000 / 1304.88 / 3894B | 534 / 160200 / 640.93 / 2081B |
| 5k | 2000 / 600000 / 2956.29 / 8894B | 2000 / 600000 / 2772.59 / 10001B |
| 20k | 2000 / 600000 / 3084.49 / 8894B | 2000 / 600000 / 2905.35 / 12001B |
| 50k | 2000 / 600000 / 3171.25 / 8894B | 2000 / 600000 / 2923.25 / 12001B |

重复检测 R1-04R fresh run：1k/5k/20k/50k 全部 12/12 ground-truth 命中，
false negatives = 0，precision = 0.9231，coverage 保持诚实有界
（1990/20000 等，`complete=false` 时显式声明）。

Facets：1k = 11.88ms、5k = 21.10ms、20k = 59.28ms、50k = 191.51ms
（各 12 SQL，R1-04R 封板证据）。

组卷候选：15,000 匹配题量分页位置 1201/2000/5000/10000/15000 全部正确，
`total=15000`，candidate 模式 `allIds <= 1200` 且 `candidateLimited=true`，
不返回整套候选 ID。

## 5. 根因结论

### 5.1 SCHEDULE_PARTIAL_LOAD_ROOT_CAUSE

`OTHER`：恰好为 50 的整数倍的行数从未触发 `done`（旧逻辑只判断 `rows.length
< 50`），且已确认任务重放响应缺 `done: true`，客户端最多循环 20 次后停止，
于是“数据库已完整、界面仍显示部分”并进入只导一半的假象。修复后 120 行固定
3 个请求，50 行恰好 1 个请求，smoke 矩阵全部 `done=true` 且 DB 对账通过。

### 5.2 TOP_LATENCY_CAUSE

1. `/api/classes` 无分页：基准过程 4,300 个临时班级时 lessons 流 API payload
   约 1.357MB（`/lessons → /schedule-imports` useful 728ms 的主因）；清理后
   真实小工作区仅 301B，属班级量级增长时的观察项，不阻塞本轮。
2. 冷启动首次工作区导航：Chrome cold `/workspace` total ≈ 2.4s（warm ≈ 1.2s），
   主要是首次编译与 96–99 个静态资源加载。
3. 课表 confirm 逐行 SQL：已由 50 行 chunk + 请求级缓存改为有界批处理，500 行
   从单请求约 20s 变为 10 个有进度请求约 14.9s。

## 6. 最终质量门禁

| Gate | Result | Details |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit` 0 错误 |
| Lint | PASS | 0 error；untracked 脚本 3 warning（unused vars） |
| Full Tests | PASS | 346 pass / 0 fail / 0 skipped |
| Build | PASS | `vinext build` 成功 |
| Teaching E2E | PASS | 2 轮、60 项业务检查 |
| Surface Audit | PASS | 30 pages / 119 API / 328 checks / 0 anomalies |
| API Audit | PASS | 119/119 有测试或脚本引用 |
| R1 Regression | PASS | schedule-import-chunked 4/4 |
| Migration | N/A | 本轮无 schema/migration 变更 |
| Scale Scenario | PASS | R1-04R 1k/5k/20k/50k 证据 |

测试数：R1 复核基线 328；R1-04R 封板后 342；本轮新增
`schedule-import-chunked` 4 项；门禁实测 346。

## 7. Git 状态与代码审查

- `HEAD = 274a43f8bdad92414cb8fee043f605cf9a13c9e1` = `origin/main`
- 本轮未新增 commit、未 push（用户指令：完成后直接上线，不等待统一确认；
  目标文档默认不 push）
- `git diff --check` 干净（仅 LF→CRLF 提示）
- 修改文件：`app/api/schedule-imports/[id]/confirm/route.ts`、
  `app/api/schedule-imports/route.ts`、`app/components/HardNavigationLink.tsx`、
  `app/components/WorkspaceNavigation.tsx`、`app/lib/schedule-import-identity.ts`、
  `app/lib/schedule-import-preview.ts`、`app/schedule-imports/page.tsx`、
  `tests/rendered-html.test.mjs`（173 insertions / 32 deletions）
- 新增未跟踪文件：`docs/r1-followup-plan-2026-08-08.md`、
  `docs/verification-2026-08-08-r1.md`、`docs/P1_PERFORMANCE_FINAL_REPORT.md`、
  `scripts/performance-smoke.mjs`、`scripts/verify-gates.mjs`、
  `tests/schedule-import-chunked.test.mjs`

## 8. 剩余风险

- **生产认证 smoke BLOCKED**：无 `PROD_SMOKE_TEACHER` 生产凭据，本地凭据在
  生产 401；不覆盖生产 Secret、不放宽认证。公开 smoke 可执行。
- `/api/classes` 无分页：真实小工作区无感，班级量级增长时会线性放大；
  建议后续单独排期（P2）。
- 题库近似重复为有界候选 + 诚实 coverage，不承诺超过候选预算的全库穷举；
  R1-04R 已关闭全部可复现 ground-truth 缺口。
- Cloudflare Worker CPU 无法从本地直接测量，性能数据均为本地 dev server /
  in-memory SQLite 证据。
- 存量无 lineage 的历史导入在跨日期修订歧义时保持 blocked，不自动改写历史数据。

## 9. 最终发布状态

```text
SCHEDULE_PARTIAL_LOAD_ROOT_CAUSE: OTHER
SCHEDULE_IMPORT_RELIABILITY: PASS
SCHEDULE_IMPORT_PERFORMANCE: PASS
SITE_NAVIGATION_PERFORMANCE: PASS
SITE_PERCEIVED_RESPONSIVENESS: PASS
TOP_LATENCY_CAUSE_1: /api/classes 无分页（4,300 班级时约 1.357MB payload）
TOP_LATENCY_CAUSE_2: 冷启动首次工作区导航（Chrome cold total 约 2.4s）
TOP_LATENCY_CAUSE_3: 课表 confirm 逐行 SQL（已 50 行 chunk 有界化）
10_ROW_IMPORT: 339.85ms / 1 request
50_ROW_IMPORT: 1472.86ms / 1 request
100_ROW_IMPORT: 2830.52ms / 2 requests
200_ROW_IMPORT: 5803.54ms / 4 requests
500_ROW_IMPORT: 14887.73ms / 10 requests
FULL_TESTS: 346 pass / 0 fail / 0 skipped
TEACHING_E2E: PASS (2 rounds, 60 checks)
SURFACE_AUDIT: PASS (30 pages / 119 API / 328 checks / 0 anomalies)
API_AUDIT: PASS (119/119)
BUILD: PASS
PRODUCTION_PUBLIC_SMOKE: PASS (`/` 200、`/teacher-login` 200、`/api/session` 200 JSON)
PRODUCTION_AUTH_SMOKE: BLOCKED
P0: NONE
P1: NONE
FINAL_HEAD: 274a43f8bdad92414cb8fee043f605cf9a13c9e1
DEPLOYED_SHA: 274a43f8bdad92414cb8fee043f605cf9a13c9e1
SITES_VERSION: 61 (appgver_fad817e4fd008191a48dbbbd0cb24d46)
FINAL RELEASE STATUS: READY FOR STAGING
```
