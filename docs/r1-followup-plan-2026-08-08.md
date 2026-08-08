# 知师研室 R1 Follow-up 生产收尾与证据闭环计划（2026-08-08）

> 复核人：Codex（本地仓库核验 + Node 22 实际复跑 + 线上 smoke 复测）
> 范围：本轮不新增产品功能，只闭环 R1 报告暴露的证据缺口、测试真实度与生产残留风险，
> 并把“部署可追溯、门禁可复现、线上可验证”固化为后续每轮的标准动作。
> 前提：R1（`6d167de..4ac67f8`）的实现、测试、基准与部署已核验为真实；
> 本轮按本清单逐项修复并记录证据，全部完成后重新跑第 5 节门禁。

## 1. 复核依据

1. Git 层面对齐：`30 files changed, 3059 insertions(+), 366 deletions(-)`，
   `git diff --check` 通过，工作树 clean。
2. 测试可复现：`npx -y node@22`（v22.23.2）实际复跑 `pnpm test`，
   `328 pass / 0 fail / 0 skipped`；测试数 = R1 前 299 + 新增 29。
3. 源码门禁：`pnpm typecheck` 通过；源码范围 ESLint 0 error；但裸 `pnpm lint`
   会被 `outputs/.stage-*` 内两份构建产物污染，产生 660 个非源码 error。
4. 审计产物：`outputs/scale-benchmark.json`、`outputs/surface-audit.json`、
   `outputs/api-inventory.json`、`outputs/teaching-loop-e2e.json` 与 R1 报告逐项一致。
5. 线上 smoke：`/`、`/api/session`、`/teacher-login` 均 200，
   `/api/session` 返回 `{"authenticated":false}`；`outputs/site-4ac67f8.tar.gz`
   存在且包含 `0028_schedule_import_recovery.sql`。

## 2. 现状缺口

### 2.1 门禁可复现性

- `npm run lint` 未忽略 gitignored 的 `outputs/**`，部署暂存目录里的压缩产物
  会被当成源码检查；同一命令在干净 clone 与当前工作区结果不同。
- 报告中的 328 tests 没有随报告保留原始日志；验证命令、Node 版本与产物缺失。
- 本机默认 Node 是 v20.15.0，项目要求 `>=22.13.0`，没有统一的本地版本入口。

### 2.2 部署可追溯性

- `main` 领先 `origin/main` 4 个提交，R1 尚未同步到 GitHub `origin`。
- 本地只有 `origin` remote，报告中的 “Sites remote push” 无法从 git 配置复现。
- 没有部署记录文档；部署 ID、URL、tar SHA-256、smoke 结果与 D1 migration 状态
  散落在输出目录，无法回溯“线上到底跑的是哪个 commit”。
- 线上 D1 是否已应用 0028 没有直接证据；本地 D1 与部署包只能证明内容一致。

### 2.3 测试真实度

- `tests/schedule-import-consistency.test.mjs` 使用自行实现的
  `confirmRowLikeRoute` 复刻 route 逻辑，未直接调用真实 route handler。
- `tests/question-source-security.test.mjs` 第一项使用正则检查 route 源码，
  其余场景走真实 `node:sqlite`，但尚未全部路由级黑盒化。
- finance/candidate 相关测试以 helper 层为主，route 层的鉴权、请求解析与响应
  契约仍有盲区。

### 2.4 生产残留风险

- R2 source 原始对象无定时清理，失败导入会留下有界但持续的存储残留。
- 性能基准全部来自本地 in-memory D1，线上 Cloudflare Worker CPU 未测量。
- 存量已确认导入无 lineage，跨日期修订遇到歧义只能 blocked，没有可审计清单。

## 3. 详细计划单

状态标记：`待办` / `进行中` / `已完成（日期）`。

### R1F-01 修复 lint 忽略规则

- 状态：待办
- 优先级：P1
- 现状：`package.json` 的 `lint` 只忽略 `dist/.next/.artifacts/public/ocr`，
  未忽略 `outputs/**`。
- 理由：`outputs/` 已 gitignore，里面的 `.stage-*` 是部署暂存目录；把它们当源码
  检查会让同一命令在不同机器上给出不同结果。
- 修复：在 `eslint.config.mjs` 的 `globalIgnores` 中增加 `outputs/**`，或等价地在
  lint script 增加 `--ignore-pattern outputs`；不改动任何业务代码。
- 验收：`pnpm lint` 在当前工作区 0 error 退出；`outputs/.stage-*` 不再被扫描；
  新增测试不依赖 lint 忽略规则。

### R1F-02 固化门禁验证脚本

- 状态：待办
- 优先级：P1
- 现状：typecheck、lint、test、audit、e2e 各自独立，验证证据靠人工收集。
- 理由：报告需要“可重复、可留痕”的原始证据，不能只写结论。
- 修复：
  1. 新增 `scripts/verify-gates.mjs`，按顺序执行 typecheck、lint、test、build、
     teaching e2e、surface audit、api inventory strict。
  2. 脚本记录 Node 版本、git SHA、各步退出码、测试统计与耗时，写入
     `outputs/gates-<sha>.json`。
  3. 任一门禁失败立即以非零退出码结束并保留部分日志。
- 验收：脚本一次运行即产出完整 JSON；CI 与本地使用同一命令。

### R1F-03 补齐 R1 验证文档

- 状态：待办
- 优先级：P1
- 现状：R1 报告没有附带原始测试日志，只有结论。
- 理由：328 tests 是本次核心证据，需要版本、命令、日志与产物可追溯。
- 修复：新增 `docs/verification-2026-08-08-r1.md`，记录 `4ac67f8` 的复核结果：
  Node v22.23.2、328 pass、typecheck 通过、源码 lint 通过、线上 smoke 3 URL 全 200。
- 验收：文档可由另一台机器按步骤复现；每项结论对应命令或产物路径。

### R1F-04 同步 origin/main

- 状态：待办
- 优先级：P1
- 现状：`main` 领先 `origin/main` 4 个提交（`d050573`、`29784fb`、`6d167de`、
  `4ac67f8`）。
- 理由：部署版本与 GitHub 版本不一致时，无法用仓库状态判断线上代码。
- 修复：用户明确授权后执行 `git push origin main`，确认远端 HEAD 与本地一致。
- 验收：`git log origin/main..HEAD` 为空；CI 对 push 触发的检查通过。

### R1F-05 建立部署记录文档

- 状态：待办
- 优先级：P1
- 现状：部署 ID、URL、tar 与 smoke 结果没有统一记录。
- 理由：部署可追溯是生产变更的基本要求，也是“Sites remote”无法本地复现后的
  替代证据链。
- 修复：新增 `docs/deployments.md`，每行记录 commit、构建产物 SHA-256、tar 包、
  部署 ID、URL、smoke 结果、D1 migration 状态；先补 R1 记录。
- 验收：文档可从当前 `outputs/site-4ac67f8.tar.gz` 与线上 URL 反查每个字段。

### R1F-06 验证线上 D1 migration

- 状态：待办
- 优先级：P1
- 现状：本地 D1 与部署包均包含 0028，但线上 D1 未直接核验。
- 理由：migration 是否真正应用到线上是 R1 数据库正确性的前提。
- 修复：二选一：用 `wrangler d1 execute --remote` 查询 migration 表；或新增
  teacher-admin 保护的 `GET /api/system/status`，返回已应用 migration 列表、
  `schedule_import_rows` 关键列与索引。
- 验收：线上返回 0028 已应用，且 `processing_state/attempts/source_lineage/
  source_row_id/source_cell` 存在；记录写入 R1F-05。

### R1F-07 编写可重复部署脚本

- 状态：待办
- 优先级：P1
- 现状：部署依赖手工 push/上传，报告中的 Sites remote 不可复现。
- 理由：部署必须由脚本固定：build、打包、上传、smoke、记录。
- 修复：新增 `scripts/deploy.mjs`，按顺序执行：
  1. `pnpm build`
  2. 校验迁移文件已包含
  3. 生成 tar 与 SHA-256
  4. 上传到 Sites/Cloudflare
  5. 执行 `/`、`/api/session`、`/teacher-login` smoke
  6. 追加写入 `docs/deployments.md`
- 验收：脚本从 `main` 可完整执行；部署记录与线上状态一致；失败时不清空旧版本。

### R1F-08 可选：CI 自动部署

- 状态：待办
- 优先级：P2
- 现状：CI 只检查，不部署；线上更新仍靠人工。
- 理由：`origin/main` 与线上版本收敛后，自动部署能消除“本地构建、手工上传”
  的版本漂移。
- 修复：新增 GitHub Actions deploy job，push `main` 后调用 R1F-07 脚本；
  部署产物作为 action artifact 留存。
- 验收：合并或 push 后线上版本等于 `origin/main` HEAD；失败可回滚。

### R1F-09 建立 route 级测试 harness

- 状态：待办
- 优先级：P1
- 现状：R1 关键测试以 helper 层为主，route 层未黑盒直测。
- 理由：鉴权、请求解析、状态码与响应契约只在 route 层，helper 全绿不能证明
  route 正确。
- 修复：新增 `tests/helpers/route-harness.mjs`，支持加载 `app/api/**/route.ts`，
  注入真实 `Request`、本地 D1、R2 mock 与 session，直接调用导出的 handler。
- 验收：至少 schedule confirm、finance confirm、question source 三条路由可被
  harness 直接调用；失败信息包含 route 文件名与 HTTP 方法。

### R1F-10 课表 confirm 测试黑盒化

- 状态：待办
- 优先级：P1
- 现状：`tests/schedule-import-consistency.test.mjs` 自行实现
  `confirmRowLikeRoute`。
- 理由：测试逻辑与 route 实现一旦漂移，测试会继续绿但 route 已坏。
- 修复：改用 R1F-09 harness 直接调用 `POST /api/schedule-imports/[id]/confirm`，
  保留中断恢复、finance 失败、重复 confirm、10 次连续 confirm 等 SQL 断言。
- 验收：所有现有场景通过；不再引用 `confirmRowLikeRoute`；测试统计记录更新。

### R1F-11 source 安全测试黑盒化

- 状态：待办
- 优先级：P1
- 现状：`tests/question-source-security.test.mjs` 第一项是正则静态检查。
- 理由：静态检查只能确认“源码里有某段文本”，不能确认运行时行为。
- 修复：用 R1F-09 harness 直接调用 source GET 路由，8 个场景全部请求级执行；
  静态检查只保留为辅助契约测试。
- 验收：8 项测试全部通过；teacher、assistant 授权与恶意 key 均走真实路由。

### R1F-12 finance 与 candidate route 级测试

- 状态：待办
- 优先级：P2
- 现状：finance idempotency 与 candidate 分页主要覆盖 helper。
- 理由：幂等响应头、409、replayed 标记与分页参数解析属于 route 契约。
- 修复：为 `app/api/finance/route.ts`、`app/api/questions/route.ts` 增加 route
  级测试，覆盖精确重放、改 payload、409、candidate 有界与分页。
- 验收：新测试全部通过；`api:inventory` 引用更新；测试总数按实际新增记录。

### R1F-13 R2 source 清理任务

- 状态：待办
- 优先级：P1
- 现状：失败导入的原始 R2 source 对象无定时清理，属于报告承认的残留风险。
- 理由：长期积累会造成存储成本与敏感文件生命周期失控。
- 修复：新增 `scripts/cleanup-source-objects.mjs` 或 Worker 定时任务：
  1. 标记失败/放弃导入对应的 source 对象。
  2. 超过 7 天 TTL 才进入清理候选。
  3. 默认 dry-run，正式清理写审计日志，失败对象保留。
  4. 不删除已确认导入引用的对象。
- 验收：dry-run 与正式清理均幂等；审计日志完整；有测试覆盖 TTL 边界与引用保护。

### R1F-14 线上性能证据

- 状态：待办
- 优先级：P1
- 现状：scale benchmark 全部为本地 in-memory D1，线上 Worker CPU 未测量。
- 理由：是否给 facets 加索引应由线上真实负载决定，不能只凭本地 SQLite 时序。
- 修复：
  1. 题库导入、facets、candidate 路由增加 `benchmark_ms / sql_count / coverage`
     日志。
  2. 用 `wrangler tail` 抓取一次 20k 合成场景的线上耗时与 CPU 指标。
  3. 根据数据决定 facets 是否加 index，并把结论写进部署记录。
- 验收：线上日志可量化每次请求的 SQL 数与耗时；索引决策有真实数据依据。

### R1F-15 存量 lineage 审计清单

- 状态：待办
- 优先级：P2
- 现状：存量已确认导入没有 lineage，跨日期修订歧义时只能 blocked。
- 理由：不自动改写历史数据是对的，但教师需要知道自己哪些导入受影响。
- 修复：新增 teacher-admin 可见的“无 lineage 历史导入清单”，包含导入时间、
  文件、行数、确认状态；只读，不做自动回填。
- 验收：清单可导出或打印；不产生任何写操作；文档说明后续人工处理边界。

### R1F-16 迁移备份纪律

- 状态：待办
- 优先级：P1
- 现状：R1 0028 上线前没有可查的备份记录。
- 理由：D1 migration 是不可回滚的生产变更，必须保留备份校验值。
- 修复：任何新 migration 上线前按 `docs/d1-backup.md` 备份 D1，记录备份时间、
  文件路径、SHA-256 与迁移前后版本，写入 R1F-05 部署表。
- 验收：0029 起每次迁移都有备份记录；R1F-06 的 migration 验证在备份后执行。

### R1F-17 学生/家长门户登录（产品决策）

- 状态：待办
- 优先级：P3
- 现状：`/portal` 与门户 API 暂按教师管理员登录保护，README 已如实说明。
- 理由：开放学生/家长登录涉及账号体系、隐私边界与产品确认，不应混入本轮。
- 修复：单独立项，设计角色矩阵、登录方式、最小数据视图与审计规则后实施。
- 验收：待产品确认后另行验收；本轮不实现。

### R1F-18 资源详情管理态（产品决策）

- 状态：待办
- 优先级：P3
- 现状：详情 API 已返回 `canManage`，页面尚无登录教师编辑/删除入口。
- 理由：管理态扩大会改变公开详情页的交互与权限展示，需要产品确认。
- 修复：单独立项，在详情页增加登录教师可用的编辑/删除入口，保持匿名边界不变。
- 验收：待产品确认后另行验收；本轮不实现。

### R1F-19 公开资源全文检索（性能增强）

- 状态：待办
- 优先级：P3
- 现状：公开资源检索仍为 SQL LIKE。
- 理由：资源量增大后可评估 D1 FTS5 或独立索引，属于性能增强，不改变权限边界。
- 修复：单独立项，先做规模基准，再决定索引方案。
- 验收：待资源量证据充分后另行验收；本轮不实现。

## 4. 执行顺序

建议批次：

1. 批次 A（门禁与仓库卫生）：R1F-01 → R1F-02 → R1F-03 → R1F-04
2. 批次 B（部署与线上）：R1F-05 → R1F-06 → R1F-07 → R1F-08
3. 批次 C（测试黑盒化）：R1F-09 → R1F-10 → R1F-11 → R1F-12
4. 批次 D（生产风险）：R1F-13 → R1F-14 → R1F-15 → R1F-16
5. 批次 E（产品决策）：R1F-17 → R1F-18 → R1F-19，等产品确认后单独排期

依赖关系：A 全部完成后才能跑 R1F-04；B 依赖 R1F-05 的部署表；C 依赖
R1F-09；D 可并行准备，但验收统一在批次末尾。

## 5. 全量门禁

每完成一项执行并记录证据：

```bash
node -v                          # 22.x
pnpm typecheck                   # 通过
pnpm lint                        # 通过，0 error
pnpm test                        # 328+ pass / 0 fail / 0 skipped
pnpm build                       # 通过
pnpm teaching:e2e                # 2 rounds、全部 ok
node scripts/surface-audit.mjs   # 30 pages / 119 API / 328 checks / 0 anomalies
pnpm api:inventory -- --strict   # 119/119 covered
pnpm mini:production-guard       # 生产 mini 全禁用
```

执行须知：

- 本机默认 Node 为 v20，门禁统一用 Node 22.13+；临时可用
  `npx -y node@22` 或项目提供的版本管理入口。
- 跑 guard/e2e 前确认端口 3000 无残留 dev server。
- 不提交 `.dev.vars.*`、`outputs/`、`dist/`；不回滚用户未请求的改动。
- 每批次完成后把验证证据追加到本文件，并在 `docs/deployments.md` 更新线上状态。

## 6. 本轮验收产物

- `docs/r1-followup-plan-2026-08-08.md`：本计划清单。
- `docs/verification-2026-08-08-r1.md`：R1 复核证据。
- `docs/deployments.md`：部署与 migration 记录。
- `scripts/verify-gates.mjs`、`scripts/deploy.mjs`、`scripts/cleanup-source-objects.mjs`。
- `tests/helpers/route-harness.mjs` 与 route 级测试。
- `outputs/gates-<sha>.json`：门禁原始证据。
- 线上 D1 0028 验证记录与 smoke 结果。

## 7. 后续建议

- 学生/家长门户、资源详情管理态、公开资源全文检索按 R1F-17～R1F-19 单独排期。
- 小程序保持暂停，任何恢复都先过 `mini:production-guard`。
- 后续每轮报告必须附 R1F-02 的 gate JSON，不再手工声明“全部通过”。
