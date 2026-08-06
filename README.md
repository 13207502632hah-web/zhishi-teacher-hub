# 知师研室｜初高中教师教学工作台

面向初高中教师的一体化教学工作台，覆盖课前备课、课时记录、作业与反馈、
题库组卷、学情分析、教研反思和课时结算，部署在 Cloudflare Workers 上，
使用 D1 作为主数据库、R2 存放文件。

## 功能模块

| 分组 | 模块 | 路由 | 说明 |
| --- | --- | --- | --- |
| 今日 | 工作台 | `/workspace` | 今日课程、待办、本周概览、关注学生与快捷入口 |
| 教学 | 课时 | `/lessons` | 课时列表与日历、新建编辑、完成/取消/调课/补课、时间冲突提示、费用与打印 |
| 教学 | 作业中心 | `/assignments` | 草稿/发布、班级或指定学生、附件、提交待办、批改确认、订正版本 |
| 教学 | 课程反馈 | `/feedback` | 单节/阶段模板、真实数据汇总、确认、复制与打印 |
| 教学 | 反馈反向解析 | `/feedback-imports` | 从已有文本反向解析为结构化反馈草稿 |
| 教学 | 课表导入 | `/schedule-imports` | 课表批量导入、差异预览与提交 |
| 教学 | Apple 日历 | `/calendar` | 课时日历视图与外部日历集成 |
| 题库 | 题库 | `/questions` | Word 四步校对导入、重复检测、批量标签/知识点/状态、检索与标记 |
| 题库 | 组卷 | `/papers` | 按阶段/年级/知识点组卷，学生版/教师版/答案解析版打印 |
| 学情 | 学生 | `/classes`、`/students` | 班级编辑与归档、学生档案、学校/教材/考试目标、筛选与隐私最小展示 |
| 学情 | 测验与成绩 | `/assessments` | 测验项目与成绩记录 |
| 学情 | 考试项目 | `/exam-projects` | 考试项目规划与结果追踪 |
| 学情 | 答题卡校对 | `/recognition` | 答题卡识别结果的人工校对 |
| 学情 | 学年晋升 | `/academic-years` | 学年切换与学生年级晋升 |
| 教研与运营 | 教学反思 | `/reflections` | 私密反思、日历、检索与策略沉淀 |
| 教研与运营 | 数据中心 | `/analytics` | 周/月/学期真实指标，数据不足时不输出结论 |
| 教研与运营 | 资源中心 | `/resources` | 公开资源入口，私有资源按角色展示 |
| 教研与运营 | 课时结算 | `/finance` | 结算预览、安全确认、实收登记、月度汇总与导出 |
| 账户 | 设置 | `/settings` | 角色与账号、助教班级授权、演示数据、导出、删除与审计日志 |
| 账户 | 微信小程序 | `/mini-settings` | 功能暂停，代码保留；AppID 仅用于本地/开发验证 |

另有学生/家长只读门户 `/portal`，只展示与本人关联且已确认的内容。
微信小程序目录已暂停，导航中以“微信小程序（暂停）”标识。

## 技术栈

- Next.js 16.2.6 + React 19.2.6，TypeScript
- [vinext](https://github.com/cloudflare/vinext) 0.0.50 + Cloudflare Workers
- Cloudflare D1（绑定名 `DB`）与 R2（绑定名 `FILES`），声明见 `.openai/hosting.json`
- Tailwind CSS 4 + 项目内 CSS Modules
- Drizzle ORM（`db/schema.ts`，迁移生成见 `drizzle.config.ts`）
- 本机 OCR：Tesseract.js 中文识别；可选 `RECOGNITION_PROVIDER` /
  `RECOGNITION_API_KEY` 接入供应商识别

## 本地开发

前置要求：Node.js `>=22.13.0`，推荐使用 pnpm。CI 固定 Node 22
（`.github/workflows/ci.yml`），本地使用 Node 22.13+ 或 Node 24 均可；
`node:sqlite` 相关脚本在 Node 22.13+ 会打印 ExperimentalWarning，不影响结果。

```bash
pnpm install
pnpm db:init
pnpm dev
```

启动前先把 `.env.example` 复制为 `.dev.vars` 并填写教师管理员账号、密码与
会话密钥；需要试用 DeepSeek 时再填写 `DEEPSEEK_API_KEY` 并把
`DEEPSEEK_AI_ENABLED` 设为 `true`。真实密钥只放在未纳入 Git 的
`.dev.vars` 中，生产环境通过 Sites Secret 配置，不写入源码、`hosting.json`
或浏览器。微信相关变量只用于本地微信开发者工具测试，生产必须关闭。
`pnpm db:init` 会确定性地应用 `drizzle/` 下全部迁移并校验必需表，首次启动
前执行一次即可。

详细说明见 [docs/getting-started.md](docs/getting-started.md)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动本地开发服务器 |
| `pnpm db:init` | 初始化本地 D1：应用全部迁移并校验必需表 |
| `pnpm build` | 验证生产构建 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm lint` | ESLint 全量检查 |
| `pnpm test` | 构建后运行单元/源码校验测试 |
| `pnpm teaching:e2e` | 本地 D1 教学闭环端到端回归 |
| `pnpm mini:production-guard` | 模拟生产环境验证小程序接口整体禁用 |
| `pnpm db:generate` | 修改 `db/schema.ts` 后生成 Drizzle 迁移 |
| `pnpm mini:verify` | 微信小程序自动化验收（功能暂停中） |

## 项目结构

- `app/`：Next.js 路由、页面组件与 API 路由
- `app/lib/`：认证、权限、计费、AI 与领域服务
- `db/`：Drizzle schema
- `drizzle/`：生成的迁移
- `scripts/`：本地校验、自动化与 e2e 脚本
- `tests/`：源码与接口校验测试
- `docs/`：架构、安全、测试与小程序集成文档
- `mini-program/`：微信小程序（当前暂停，不参与线上发布）

## 安全与权限要点

- 默认单教师工作区；首位登录用户初始化为教师，后续账号由教师在设置中分配角色。
- 助教必须逐班授权；学生、家长只进入只读门户。
- 真实姓名、监护人联系方式与评价记录按敏感数据处理，列表不展示联系方式。
- 删除、导出、批量修改需二次确认；关键操作进入审计日志。
- 题目导入先检测重复，进入“待校对”，人工复核完成后才进入正式题库。
- 作业发布、最终提交、确认批改和结算确认使用稳定 `operationId` 幂等，
  结算确认还需回传预览生成的 `previewToken`。

更多内容见 [docs/security.md](docs/security.md)。

## 文档

- [架构说明](ARCHITECTURE.md)
- [本地启动指南](docs/getting-started.md)
- [安全说明](docs/security.md)
- [测试说明](docs/testing.md)
- [演示数据说明](docs/demo-data.md)
- [小程序集成说明](docs/mini-program-integration.md)
- [数据库备份与恢复](docs/d1-backup.md)
- [贡献指南](CONTRIBUTING.md)
