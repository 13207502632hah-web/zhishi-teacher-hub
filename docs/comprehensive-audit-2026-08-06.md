# 知师研室全面复核与修复计划（2026-08-06）

> 复核人：Codex（GitHub connector + 本地静态盘点 + 完整验证）
> 结论：功能主体完整、测试全绿；主要风险集中在 CI 未生效、页面服务端保护不统一、文档与实现不一致、e2e 覆盖不全。

## 1. 复核范围与方法

### 1.1 复核目标

1. 检索 GitHub 上已有同类/相似项目，作为成熟度对照。
2. 对本站已有内容做全面复核：页面、API、鉴权、数据库、文档、CI、测试、密钥与占位残留。
3. 输出详细计划单，每项附理由、优先级与验收方式，供后续修复直接执行。

### 1.2 复核方法

- GitHub：通过 GitHub connector 检索安装仓库与公开项目，并用 GitHub REST API 核验 star、语言与描述。
- 本地静态盘点：`app/` 页面与 API 路由清单、`db/schema.ts`、`drizzle/` 迁移、`app/lib`、`tests/`、`.github/`、`.env.example`、README 与 docs。
- 鉴权扫描：对 118 个 `app/api/**/route.ts` 做关键词级扫描，并抽查关键路由实现。
- 文档一致性：README / ARCHITECTURE / docs 与实际路由、功能开关对照。
- 运行时验证：`pnpm typecheck`、`pnpm lint`、`pnpm test`（构建 + 257 项测试）、`pnpm teaching:e2e`（演示数据 + 教学闭环 + AI 模拟 + 异常路径）。

## 2. GitHub 同类项目对照

| 项目 | star | 语言/技术栈 | 对照启示 |
| --- | --- | --- | --- |
| hrshadhin/school-management-system | 1131 | Blade/PHP | 学校管理系统的多角色账号、班级/课程/成绩闭环 |
| francoisjacquet/rosariosis | 642 | PHP | 学生信息系统：细粒度角色权限、模块化、长期维护 |
| frappe/education | 591 | Python/Frappe | 教育管理：可扩展业务对象与统一权限框架 |
| joeseesun/qiaomu-blog-opensource | 292 | TypeScript, Next.js 16 + D1 + R2 | 技术栈最接近：验证 Cloudflare D1/R2 栈可维护 |
| rifah07/a-teaching-saas-app | 0 | TypeScript, Next.js + Supabase + AI | AI 教学 SaaS 的登录托管与 AI 边界设计 |
| 12rishi/BrillAcademia | 1 | TypeScript, Next.js + MongoDB | LMS 的角色、课程售卖与支付集成 |

### 2.1 对照结论

成熟项目普遍具备：

- 多角色账号体系与权限矩阵；
- 可复现的本地环境初始化；
- CI 作为质量门禁（含数据库迁移与测试）；
- 数据库迁移与备份/恢复说明；
- 完整的产品与安全文档。

本站已具备：

- 教师 / 助教 / 学生 / 家长角色，助教逐班授权；
- 118 个 API 路由全部带服务端鉴权代码路径；
- 审计日志、幂等写入、结算 previewToken、删除二次确认；
- Drizzle 迁移、演示数据创建/清除、本地 OCR、AI 草稿边界；
- README、ARCHITECTURE、security/testing/demo-data/getting-started 文档；
- 257 项单元/源码测试 + 教学闭环 e2e 全绿。

主要差距：

1. CI 尚未真正成为质量门禁（`.github/` 未提交；e2e `continue-on-error` 且依赖本地 D1）；
2. 除 `/workspace` 外，页面保护依赖客户端 `AppShell`，服务端 gate 不统一；
3. README/ARCHITECTURE 路由表与实现不一致，产品元数据仍是脚手架占位；
4. e2e 未覆盖全部页面/API（analytics、exam-projects、recognition、resources、schedule-imports、reflections、question-views、portal、mini 等）；
5. 本地 D1 初始化、备份/恢复没有确定性脚本与演练文档；
6. 权限矩阵没有完整成文。

## 3. 本站现状复核结果

### 3.1 已验证事实

- 页面：29 个 `page.tsx`，均接入 `AppShell`（`teacher-login` 除外）；`/workspace` 额外做服务端 `requireTeacherAdmin`。
- API：118 个 `route.ts`，静态扫描全部命中鉴权/令牌关键词；`auth/login`、`auth/logout` 为有意公开入口。
- 运行时探测：`scripts/surface-audit.mjs` 对 29 页面 + 118 API 共执行 317 项正常/异常探测；修复后最终 0 项异常（原 28 项 = 26 项页面服务端 gate（P1-03）+ 2 项真实删除缺陷（P1-04/P1-05），已在批次 A 消除）。
- 数据库：`db/schema.ts` 84 张表；`drizzle/` 28 个迁移。
- 领域层：`app/lib` 33 个文件。
- 测试：`tests/` 38 个 `*.test.mjs`，共 257 项全部通过（新增 assistant 导航权限回归 1 项）；`scripts/teaching-loop-e2e.mjs` 通过，报告写入 `outputs/teaching-loop-e2e.json`。
- 运行时复现：`scripts/reproduce-runtime-issues.mjs` 已抓取 3 个真实 500（课时删除、试卷删除、演示数据清理），并验证 mini 登录/会话/登出闭环，报告写入 `outputs/runtime-repro.json` 与 `outputs/runtime-repro-server.log`。
- 残留扫描：未发现真实 `TODO/FIXME/HACK/@ts-ignore`；密钥仅出现在 `.env.example` 空值位。
- CI 文件：`.github/workflows/ci.yml`、`.github/ISSUE_TEMPLATE/*.yml`、`.github/PULL_REQUEST_TEMPLATE.md` 存在，但整个 `.github/` 尚未纳入 Git。
- 环境变量：`.env.example` 提供教师账号、会话密钥、DeepSeek、OCR、微信占位；真实密钥不在仓库。

### 3.2 问题清单

> 执行状态（2026-08-06）：P1-01～P1-06 已完成并推送（`38c8c46` /
> `756ef65` / `dedbef0`）；P2-01～P2-03、P2-05～P2-07 已完成；P2-04、P2-08
> 已补齐审计脚本与文档，业务级 e2e 扩展保留为后续项；P3 待定。

#### P1（发布/质量门禁阻断）

- **P1-01** `.github/` 未提交：本地有 CI 与 Issue/PR 模板，但 GitHub 仓库实际没有 CI，PR 质量门禁未生效。
- **P1-02** CI e2e 假绿：`ci.yml` 中 `e2e` job `continue-on-error: true`，且注释承认依赖本地 D1；在干净 CI 环境会直接失败但被吞掉。
- **P1-03** 页面服务端保护不统一：除 `/workspace` 外，其余工作台页面只靠客户端 `AppShell` gate；未登录时 SSR 仍渲染客户端初始态，敏感页面建议统一服务端重定向。
- **P1-04** 课时删除真实缺陷：`DELETE /api/lessons/[id]` 只清 `ai_feedback_drafts` 后直接删 `lessons`，演示数据下返回 500（`FOREIGN KEY constraint failed`）。
- **P1-05** 试卷删除真实缺陷：`DELETE /api/papers/[id]` 只清 `paper_questions` 后直接删 `papers`，演示数据下返回 500（`FOREIGN KEY constraint failed`）。
- **P1-06** 演示数据清理真实缺陷：`DELETE /api/settings/demo` 批量清理漏表导致 500，`demo_records` 残留，演示数据无法复位。

#### P2（一致性与覆盖）

- **P2-01** `package.json` 的 `name` 仍是 `site-creator-vinext-starter`、`version` 0.1.0，与产品/仓库名不符。
- **P2-02** README 路由表缺 `/students`、`/mini-settings` 等实际路由；OCR 说明未点明“本机 Tesseract + 可选供应商”。
- **P2-03** 微信小程序状态表述冲突：导航标“微信小程序（暂停）”，`/mini-settings` 页面却显示“正式 AppID 已配置”。
- **P2-04** 教学闭环 e2e 未覆盖全部页面/API：analytics、exam-projects、recognition、resources、schedule-imports、reflections、question-views、portal、mini 等业务断言仍集中在 `teaching-loop-e2e.mjs`；`surface-audit.mjs` 已补上全部页面/API 的运行时正常/异常探测，业务级断言仍建议继续扩展。
- **P2-05** 本地 D1 初始化依赖“先 `pnpm dev`”，没有确定性初始化脚本，CI 无法复现。
- **P2-06** 缺少 D1 备份/恢复说明与演练。
- **P2-07** 权限矩阵未完整成文（security.md 有原则，无矩阵表）。
- **P2-08** 审计脚本顺序与状态码误报：`surface-audit.mjs` 原先按字典序探测 mini 路由，`logout` 先于 `me` 执行导致 6 个伪 401；`mini/submissions` 教师角色被 403 拒绝也被误判。脚本已修正，但需保留为回归项。
- **P2-08 补充（验证踩坑）** `surface-audit.mjs` 成功删除部分演示资源后，`DELETE /api/settings/demo` 因 P1-06 500 无法完整清理，会在 `demo_records` 残留孤儿引用（业务行已删除、demo 记录仍在），导致 `pnpm teaching:e2e` 出现假失败。`demo create` 走 verified 模式只按旧 id 更新，补不回已删除行。已新增 `scripts/repair-demo-records.mjs`，按实体类型检查 `demo_records.entity_id` 是否仍存在于对应业务表并删除孤儿引用；本轮已清理 feedback/reflection/resource 各 4 条。
- **P2-09** 助教导航与 API 权限不一致：`app/components/navigation.ts` 原先只对 assistant 隐藏 `/reflections`、`/analytics`，但 `/assessments`、`/exam-projects`、`/recognition`、`/finance` 的 API 都要求 `analytics:read`，`/academic-years` 要求 `academic-years:*`，assistant 实际访问会 403。已在批次 C 中同步隐藏这五个入口，并在 `tests/workspace-navigation.test.mjs` 增加源码级回归断言。

#### P3（可选项/体验）

- **P3-01** 品牌/个人化文案硬编码：`莫老师`、`第 07 册`、`政治教学` 直接写在页面/导航，复用或开源时需参数化。
- **P3-02** mini API 生产暴露策略需确认并文档化（`login` 已用 `NODE_ENV`/`WECHAT_TEST_MODE` 防护，但缺少系统级测试）。
- **P3-03** `node:sqlite` 在 Node 22 仍提示 ExperimentalWarning；CI 固定 Node 22 即可，文档可注明。
- **P3-04** 无覆盖率统计与 API 契约清单（可选增强）。
- **P3-05** 本地系统 Node 过旧（v20 < 引擎要求 22.13），仅影响开发机，文档已声明。

### 3.3 运行时复现的真实缺陷（证据）

| 缺陷 | 触发 | 根因 | 证据 |
| --- | --- | --- | --- |
| P1-04 课时删除 500 | 登录后 `DELETE /api/lessons/1` | 只删 `ai_feedback_drafts`；课时 1 仍被 attendance=5、student_lesson_records=5、assignments=1、lesson_questions=1、wrong_questions=2、lesson_finance=1、lesson_workflow_state=1 引用 | `runtime-repro-server.log` 的 `FOREIGN KEY constraint failed`（route.ts:46） |
| P1-05 试卷删除 500 | 登录后 `DELETE /api/papers/1` | 只删 `paper_questions`；试卷 1 仍被 export_jobs=5 引用 | `runtime-repro-server.log`（route.ts:60） |
| P1-06 演示数据清理 500 | 登录后 `DELETE /api/settings/demo` | batch 漏删 `lesson_workflow_state`、`export_jobs` 等引用表，删除 `papers`/`lessons` 时外键失败；空 ID 集合还有 `IN ()` 语法风险 | `runtime-repro-server.log`（route.ts:357）；`demo_records` 残留 124 |

## 4. 详细修复计划单

> 批次状态：P1-01～P1-06 已完成；P2-01～P2-03、P2-05～P2-07 已完成；
> P2-04、P2-08 已补齐审计脚本与文档，业务级 e2e 扩展仍保留；P3 待定。

### P1-01 提交并激活 GitHub CI 与模板

- 优先级：P1
- 现状：`.github/` 整体未跟踪；GitHub 仓库无 Actions。
- 理由：没有 CI 就没有自动质量门禁；Issue/PR 模板是协作基线。
- 修复：将 `.github/` 纳入版本控制并推送；确认 Actions 首次运行通过。
- 验收：`git ls-files .github` 非空；GitHub Actions `check`、`test` 绿色。

### P1-02 让 CI e2e 确定性运行

- 优先级：P1
- 现状：e2e job `continue-on-error: true`，干净环境缺少本地 D1。
- 理由：e2e 是教学闭环最高价值验证；假绿会让回归静默漏过。
- 修复：在 e2e job 中先执行确定性 D1 初始化（封装 `wrangler d1 migrations apply` 或脚本），去掉 `continue-on-error`，并固定 Node 22；本地无法跑时明确跳过而非假绿。
- 验收：CI e2e job 在干净 runner 上完整执行 `pnpm teaching:e2e` 且失败会影响合并。

### P1-03 统一页面服务端鉴权 gate

- 优先级：P1
- 现状：`/workspace` 有服务端 `requireTeacherAdmin`；其余页面靠客户端 `AppShell`。
- 理由：纵深防御；未登录访问工作台页面不应 SSR 渲染客户端初始态；也为 SEO/爬虫与未来服务端组件留边界。
- 修复：为教师工作台页面统一加服务端 gate（教师/助教角色），门户页面限制为学生/家长，公开页保持公开。
- 验收：未登录直接访问 `/lessons`、`/finance` 等返回登录重定向；学生/家长角色访问教师页被拒绝。

### P1-04 课时删除补全级联清理

- 优先级：P1
- 现状：`app/api/lessons/[id]/route.ts` 的 DELETE 只更新 `feedback.ai_draft_id` 并删除 `ai_feedback_drafts`，随后直接删除 `lessons`。演示课时 1 存在 `attendance=5`、`student_lesson_records=5`、`assignments=1`、`lesson_questions=1`、`wrong_questions=2`、`lesson_finance=1`、`lesson_workflow_state=1`，删除必然外键失败。
- 理由：课时删除是工作台核心操作；500 让用户无法删除任何已产生教学记录的课时，且报错为无正文空响应。
- 修复：参考演示清理逻辑，在单事务 batch 中先删/解除所有引用表：`attendance`、`student_lesson_records`、`assignments`（含 `assignment_submissions`/`submission_versions`/提交与评审资产）、`lesson_questions`、`wrong_questions`、`lesson_workflow_state`、`lesson_completion_runs`、`reflections`、`schedule_import_rows`、`lesson_finance`（含 `lesson_billing_items`、关联 `settlement_items`）、`package_ledger`、`feedback_imports`、`feedback`（含 `feedback_evidence`、`ai_feedback_learning_events`）、`ai_feedback_drafts`，再删 `lessons`；或改为新增 `ON DELETE CASCADE` 迁移。删除成功/失败需返回结构化 JSON 并记录审计。
- 验收：对演示课时 1 执行 DELETE 返回 200；课时及其关联记录全部消失；对不存在的课时返回 404；对无关联课时仍可删除。

### P1-05 试卷删除补全级联清理

- 优先级：P1
- 现状：`app/api/papers/[id]/route.ts` 的 DELETE 只删 `paper_questions` 后直接删 `papers`。演示试卷 1 存在 `export_jobs=5`，删除必然外键失败。
- 理由：试卷删除后导出任务仍引用试卷，500 阻断试卷库清理；与 P1-04 同属真实数据缺陷。
- 修复：在单事务 batch 中先删除 `paper_questions`、`paper_files`、`export_jobs`；将 `assessments.paper_id`、`question_sets.paper_id`、`exam_projects.paper_id`、`lesson_workflow_state.homework_paper_id` 置空或按业务规则删除；最后删 `papers`。
- 验收：对演示试卷 1 执行 DELETE 返回 200；`export_jobs`/`paper_files` 消失，`assessments`/`question_sets`/`exam_projects` 不再引用该试卷；不存在的试卷返回 404。

### P1-06 修复演示数据清理

- 优先级：P1
- 现状：`app/api/settings/demo/route.ts` DELETE 批量清理未覆盖 `lesson_workflow_state`、`export_jobs`、`paper_files`、`feedback_imports`、`lesson_completion_runs`、`schedule_import_rows`、`exam_projects`、按 `lesson_id` 关联的 `package_ledger`，因此演示数据删除顺序在 `papers`/`lessons` 处外键失败；部分实体类型无记录时 `IN ()` 空数组还有 SQL 语法风险。POST 在已有演示数据时只做 verify/supplement，所以复现前必须先能 DELETE 清理。
- 理由：演示数据无法复位会阻塞 CI、e2e 与本地验收；当前重跑只能追加数据，无法回到干净状态。
- 修复：补全引用表删除（含 `lesson_workflow_state WHERE lesson_id IN ... OR homework_paper_id IN ...`、`export_jobs/paper_files WHERE paper_id IN ...`、`exam_projects` 按 `paper_id` 或演示标识、`feedback_imports` 按 `matched_lesson_id/confirmed_lesson_id`、`lesson_completion_runs`/`schedule_import_rows` 按 `lesson_id`、`package_ledger` 按 `lesson_id OR package_id`）；对空 ID 集合跳过对应语句；建议把新增实体类型纳入 `demo_records` 追踪；清理整体用事务并返回每表删除数。
- 验收：连续两次 `POST /api/settings/demo` → `DELETE /api/settings/demo` → `POST /api/settings/demo` 均返回 200；`demo_records` 清零；相关表无残留引用。

### P2-01 修正包名与版本

- 优先级：P2
- 现状：`name: site-creator-vinext-starter`，`version: 0.1.0`。
- 理由：仓库与产品识别、发布/工具链元数据需要准确。
- 修复：改为 `zhishi-teacher-hub` 与符合当前里程碑的版本（如 `1.0.0` 或 `0.2.0`）。
- 验收：`pnpm install` 与 `pnpm test` 通过；`package.json` 与仓库名一致。

### P2-02 同步 README/ARCHITECTURE 路由与功能说明

- 优先级：P2
- 现状：README 缺 `/students`、`/mini-settings`；OCR 说明可细化；部分模块描述滞后。
- 理由：文档是使用者与后续维护者的第一入口，必须与实现一致。
- 修复：按实际 `app/` 路由重写功能表；补充“本机 OCR（Tesseract）+ 可选供应商”；补 `/mini-settings` 状态说明。
- 验收：README 中每个路由都能在 `app/` 找到对应页面/API，无缺失无多余。

### P2-03 统一微信小程序状态表述

- 优先级：P2
- 现状：导航“暂停”，mini-settings 页面“正式 AppID 已配置”。
- 理由：功能状态不一致会让使用者误判可发布性。
- 修复：统一为“功能暂停，代码保留；AppID 仅用于本地/开发验证”，或同步恢复/暂停状态。
- 验收：README、导航、`/mini-settings`、mini-program README 四处状态一致。

### P2-04 扩展 e2e 覆盖全部页面/API

- 优先级：P2
- 现状：`surface-audit.mjs` 已覆盖全部页面/API 的运行时正常/异常探测（317 项），`teaching-loop-e2e.mjs` 仍只覆盖教学闭环核心、AI、结算、演示数据。
- 理由：目标要求“所有功能全部跑一遍，正常与异常都要测”；探测通过不等于业务断言完整。
- 修复：将 `surface-audit.mjs` 与 `reproduce-runtime-issues.mjs` 纳入常规回归命令；继续为 analytics、exam-projects、recognition、resources、schedule-imports、reflections、question-views、portal、mini 补业务级 e2e 断言。
- 验收：`teaching-loop-e2e` 报告包含这些模块的业务断言；`surface-audit` 无业务误报（mini 顺序与 403 规则已修）。

### P2-05 增加确定性 D1 初始化脚本

- 优先级：P2
- 现状：`docs` 让用户“先跑一次 `pnpm dev`”初始化 D1。
- 理由：本地与 CI 需要可复现环境；手写步骤不可靠。
- 修复：新增 `scripts/init-local-d1.mjs`（或等价 pnpm script）执行 `wrangler d1 migrations apply`，并在 docs/CI 中调用。
- 验收：全新 `.wrangler/` 下执行脚本后可直接登录并跑 `pnpm teaching:e2e`。

### P2-06 补充 D1 备份/恢复文档与演练

- 优先级：P2
- 现状：无备份/恢复说明。
- 理由：教学数据与结算数据不可丢失；成熟项目普遍有备份策略。
- 修复：新增 docs 章节，说明 `wrangler d1 export/import`、导出文件处理与恢复演练步骤。
- 验收：文档可按步骤导出、恢复一份演示数据并验证可登录。

### P2-07 补充完整权限矩阵

- 优先级：P2
- 现状：security.md 有原则，无矩阵表。
- 理由：多角色系统需要明确“教师/助教/学生/家长 × 页面/API/操作”边界，便于审计与测试。
- 修复：新增权限矩阵表，覆盖页面、API 与敏感操作（导出、删除、结算、联系信息）。
- 验收：矩阵与 `app/lib` 权限函数、API 路由实现一致；矩阵条目可被测试引用。

### P2-08 审计脚本顺序与状态码规则回归

- 优先级：P2
- 现状：已修正 `surface-audit.mjs`：mini 路由按“login/读接口 → logout 最后”顺序探测，避免 `logout` 提前销毁会话造成伪 401；`mini/submissions` 教师 token 被 403 拒绝按合法业务规则计入。
- 理由：审计脚本自身误报会污染结论，导致真实缺陷被淹没；后续修复需依赖稳定的异常清单。
- 修复：保留上述顺序与 403 规则；`reproduce-runtime-issues.mjs` 固化 mini 会话持久化断言（login 200 → me 200 → logout 200 → me-after 401）；文档注明脚本需用 Node 24 运行（`node:sqlite`）。
- 验收：连续运行 `node scripts/surface-audit.mjs` 两次，异常清单稳定为“26 项 P1-03 + 2 项删除缺陷”，不再出现 mini 伪 401/403。

### P3-01 品牌/个人化文案参数化

- 优先级：P3
- 现状：`莫老师`、`第 07 册`、政治教学等硬编码。
- 理由：开源/复用需保留品牌边界。
- 修复：抽取为配置/常量，默认保持当前品牌，提供替换入口。
- 验收：替换配置后首页与导航品牌文案同步变化，测试不受影响。

### P3-02 mini API 生产暴露策略确认

- 优先级：P3
- 现状：`login` 有 `NODE_ENV`/`WECHAT_TEST_MODE` 防护，其余 mini API 依赖会话/令牌。
- 理由：暂停中的功能不应在生产意外可用。
- 修复：确认生产部署不会启用 mini 正式登录；增加系统级测试断言生产环境拒绝。
- 验收：模拟生产环境访问 mini 登录/同步返回 403/503，且不产生数据写入。

### P3-03 固定 Node 版本并注明 SQLite 提示

- 优先级：P3
- 现状：CI 用 Node 22，本地 e2e 输出 ExperimentalWarning。
- 理由：避免工具链漂移；警告不阻塞但应记录。
- 修复：在 README/docs 注明 Node 22 与 `node:sqlite` 状态；CI 已固定 22。
- 验收：文档与 CI 版本一致，e2e 在 Node 22 稳定通过。

### P3-04 增加覆盖率与 API 契约清单（可选）

- 优先级：P3
- 现状：无覆盖率统计；118 个 API 无自动契约清单。
- 理由：便于持续追踪“所有功能都测过”。
- 修复：引入简单覆盖率/清单脚本（如 `scripts/api-inventory.mjs` 输出 API 清单与测试引用）。
- 验收：清单脚本可运行，未覆盖路由可被发现。

## 5. 执行顺序建议

- 批次 A（发布阻断）：P1-01 → P1-02 → P1-03 → P1-04 → P1-05 → P1-06。
  已完成（`38c8c46` / `756ef65` / `dedbef0`）。
- 批次 B（一致性）：P2-01 → P2-02 → P2-03。
  已完成。
- 批次 C（测试加固）：P2-04 → P2-05 → P2-06 → P2-07 → P2-08。
  P2-04/P2-08 的审计脚本与文档已补齐，业务级 e2e 断言继续扩展；P2-05～
  P2-07 已完成。
- 批次 D（可选优化）：P3-01 → P3-02 → P3-03 → P3-04。
  待执行。

## 6. 验证证据（2026-08-06）

- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量，忽略 dist/.next/.artifacts/public/ocr）。
- `pnpm test`：构建成功，256 项测试全部通过（0 fail / 0 skipped）。
- `pnpm teaching:e2e`：通过；报告 `outputs/teaching-loop-e2e.json`：12 个鉴权端点拒绝匿名、演示数据幂等、AI 模拟 12 次调用、2 轮教学闭环、1000 题基准。
- `node scripts/surface-audit.mjs`（Node 24）：29 页面 / 118 API / 317 探测 / 28 异常（26 项 P1-03 页面服务端 gate + 2 项删除缺陷）；mini 顺序与 403 误报已消除，报告 `outputs/surface-audit.json`。
- `node scripts/reproduce-runtime-issues.mjs`（Node 24）：teacher login 200 → demo create 200（verified）→ `DELETE /api/lessons/1` 500 → `DELETE /api/papers/1` 500 → demo cleanup 500 → mini login 200 → mini me 200 → mini logout 200 → mini me-after 401；`mini_sessions` 回到 0，`demo_records` 残留证明清理失败，报告 `outputs/runtime-repro.json`。
- 孤儿引用清理：`node scripts/repair-demo-records.mjs <d1.sqlite>` 删除 feedback/reflection/resource 各 4 条孤儿 demo 引用后，`pnpm teaching:e2e` 通过；修复 P1-06 后此脚本可转为回归自检工具。
- 运行时错误证据：`outputs/runtime-repro-server.log` 三条 `D1_ERROR: FOREIGN KEY constraint failed`，分别落在 `app/api/lessons/[id]/route.ts:46`、`app/api/papers/[id]/route.ts:60`、`app/api/settings/demo/route.ts:357`。
- 静态盘点：29 页面 / 118 API / 84 表 / 28 迁移 / 33 lib / 38 测试文件。
- GitHub 对照：6 个代表性项目 star、语言、技术栈已核验。

后续修复按本计划单逐项执行；执行完批次后重新运行本节全部验证命令，作为回归证据。

### 批次 B/C 验证（2026-08-06，Node 24）

- `node scripts/reproduce-runtime-issues.mjs`：通过。teacher login 200 →
  demo create 201 → `DELETE /api/lessons/53` 200 → `DELETE /api/papers/22`
  200 → demo cleanup 200 → mini 会话闭环（login/me/logout 200、me-after
  401）→ `demoRecords`/`lessons`/`papers` 均为 0，脚本以 0 退出。
- `node scripts/surface-audit.mjs`：通过。29 页面 / 118 API / 317 探测 /
  0 异常（原 28 项 P1-03 页面 gate 与 P1-04/P1-05 删除缺陷已消除）。
- `pnpm typecheck`：通过（tsc --noEmit）。
- `pnpm lint`：通过（eslint 全量）。
- `pnpm teaching:e2e`：通过；报告 `outputs/teaching-loop-e2e.json`。
- `pnpm test`：构建成功，257 项测试全部通过（新增 assistant 导航权限回归
  1 项）。
