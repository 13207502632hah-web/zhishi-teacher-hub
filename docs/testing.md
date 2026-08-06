# 测试说明

## 命令一览

| 命令 | 覆盖范围 |
| --- | --- |
| `pnpm typecheck` | 全量 TypeScript 类型检查 |
| `pnpm lint` | ESLint 全量检查（含 Next.js 核心与 TypeScript 规则） |
| `pnpm test` | 先执行生产构建，再运行 `tests/*.test.mjs` |
| `pnpm teaching:e2e` | 本地 D1 教学闭环端到端回归 |
| `pnpm build` | 生产构建验证 |
| `node scripts/surface-audit.mjs` | 全部页面/API 的运行时正常与异常探测 |
| `node scripts/reproduce-runtime-issues.mjs` | 课时/试卷删除、演示清理、mini 会话闭环回归 |

## 单元与源码校验

`tests/` 下的 `*.test.mjs` 使用 Node 内置 `node:test`：

- `core-logic.test.mjs`：直接加载 `app/lib/*` 纯函数（题库解析、相似度、
  排课、掌握度、结算、课表导入、日历、答题卡校验等）。
- 各页面/模块的 `*-redesign.test.mjs`：读取页面、API 路由与样式的源码，
  断言关键契约与防回归点，例如结算预览令牌、权限检查、导出格式、响应式样式。
- `login-rate-limit.test.mjs`：断言登录限流只信任 `cf-connecting-ip`，
  不信任 `x-forwarded-for`。

新增源码级校验时沿用现有风格：先 `readFile` 目标文件，再用 `assert.match`
与 `assert.doesNotMatch` 断言可观察契约。涉及纯函数逻辑的测试可直接
transpile 后执行 `app/lib/*`。

## 教学闭环端到端

`scripts/teaching-loop-e2e.mjs` 覆盖：

- 匿名访问 AI 接口全部返回 401，且不产生 AI 调用记录。
- 教师登录、工作台、备课、题库检索与相似题、课时工作流草稿与冲突。
- 课时完成、撤销、重复完成幂等、作业/反馈/出勤/结算落库。
- 结算 preview → confirm 的 `operationId` 与 `previewToken` 安全边界。
- AI 反馈草稿、题目审核、隐私校验、每日用量限制与审计动作。
- 1000 题组合检索性能基准与月度结算导出。

运行要求：

- 本地 D1 已初始化：先运行 `pnpm db:init`。
- 端口 3000 未被占用。
- 使用 Node.js `>=22.13.0`（项目引擎要求），脚本使用 `node:sqlite`。

e2e 依赖设置页的演示数据接口（`/api/settings/demo`）生成合成教学数据，
创建、重复执行与清除的边界见 [演示数据说明](demo-data.md)。

## 全面审计脚本

`node scripts/surface-audit.mjs` 会对 29 个页面与 118 个 API 执行正常/异常
探测（317 项），输出 `outputs/surface-audit.json`；`node
scripts/reproduce-runtime-issues.mjs` 会实际创建演示数据、删除课时与试卷、
清理演示数据并验证 mini 会话闭环，输出 `outputs/runtime-repro.json`。

两个脚本都直接读取本地 D1，依赖 Node 内置 `node:sqlite`。Node 22.13+ 会
打印 ExperimentalWarning，不影响结果。版本策略：CI 固定 Node 22，本地开发
使用 Node 22.13+ 或 Node 24 均可；Node 22 与 Node 24 均已验证。
`reproduce-runtime-issues.mjs` 断言清理后 `demo_records`、`lessons`、
`papers` 均为 0，请在干净的本地开发库上运行，不要在有真实教学数据的库上
执行。

## 小程序自动化

`pnpm mini:*` 系列脚本依赖微信开发者工具与 AppID，当前小程序功能暂停，
相关自动化仅用于保留代码回归。生产验收以网站 e2e 为准。
