# 贡献指南

## 开发环境

- Node.js `>=22.13.0`，推荐 pnpm。CI 固定 Node 22（`.github/workflows/ci.yml`），
  本地使用 Node 22.13+ 或 Node 24 均可；`node:sqlite` 相关脚本在 Node 22.13+
  会打印 ExperimentalWarning，不影响结果。
- 本地环境变量按 [docs/getting-started.md](docs/getting-started.md) 配置，
  真实密钥只写入被忽略的 `.dev.vars`。

## 提交前

至少通过以下命令：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

涉及课时、作业、反馈、结算闭环的改动，还应运行：

```bash
pnpm teaching:e2e
```

`teaching:e2e` 需要本地 D1 已初始化且 3000 端口空闲，具体见
[docs/testing.md](docs/testing.md)。

## 代码约定

- 遵循仓库既有结构与风格：页面在 `app/`，领域逻辑在 `app/lib/`，
  D1 迁移由 `pnpm db:generate` 生成。
- API 路由在服务端做权限校验，不把敏感数据暴露到客户端。
- 关键写入使用稳定 `operationId` 幂等；结算确认必须校验预览令牌。
- 新增行为需要同步更新 `tests/*.test.mjs` 或端到端脚本中的对应断言。
- 不改动与当前任务无关的文件；不提交密钥、`.dev.vars`、构建产物或
  `.worktrees/`。

## 提交信息

建议使用简洁的祈使句描述行为变化，例如：

- `fix: 结算确认要求 operationId 与 previewToken`
- `docs: 重写 README 为产品文档`
- `ci: 增加 GitHub Actions 基础检查`

## Issue 与 PR

- 提交 Issue 前先搜索是否已有重复内容，使用仓库提供的模板。
- PR 描述应说明问题、改动范围与验证结果；涉及行为变化时附上运行过的命令。
- 不要在一个 PR 中混合无关重构与功能修复。

## 安全

发现密码、会话、权限、审计或敏感数据处理问题，请直接提交 Issue 并标记为
安全相关，不要在公开渠道粘贴真实数据或密钥。
