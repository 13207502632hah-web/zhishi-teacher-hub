# R1 复核验证记录（2026-08-08）

> 复核对象：R1 提交 `4ac67f8`（`fix: harden schedule import, question scale,
> finance idempotency and source access (R1)`）。
> 本文件由 R1 Follow-up 门禁复核产生，配套可复现命令见第 3 节；本轮 Follow-up
> 的完整门禁原始证据另存于 `outputs/gates-<sha>.json`。

## 1. 复核环境

- 仓库：`zhishi-teacher-hub`，分支 `main`。
- Node：`v22.23.2`（`npx -y node@22 --version`）。
- 测试运行器：`node --test`（Node 22 内置）。
- 构建：`vinext build`（`pnpm build`）。

## 2. R1 复核结论

| 项目 | 结论 | 证据 |
|---|---|---|
| Typecheck | PASS | `tsc --noEmit` 0 错误 |
| Lint（源码范围） | PASS | ESLint 0 error / 0 warning |
| Full tests | PASS | `328 pass / 0 fail / 0 skipped` |
| Build | PASS | `vinext build` 成功 |
| 线上公开 smoke | PASS | `/`、`/api/session`、`/teacher-login` 均 200；`/api/session` 返回 `{"authenticated":false}` |
| 部署包 | PASS | `outputs/site-4ac67f8.tar.gz` 存在且包含 `0028_schedule_import_recovery.sql` |
| 本地 migration | PASS | `scripts/migration-0028-verify.mjs` 校验旧库升级、新库直建、schema 源一致 |

测试数口径：R1 前 299 + R1 新增 29 = 328。

## 3. 复现命令

```bash
npx -y node@22 --version
npx -y node@22 ./node_modules/.bin/pnpm typecheck
npx -y node@22 ./node_modules/.bin/pnpm lint
npx -y node@22 ./node_modules/.bin/pnpm test
npx -y node@22 ./node_modules/.bin/pnpm build
npx -y node@22 scripts/migration-0028-verify.mjs
```

线上 smoke（公开 URL）：

```bash
curl -s -o /dev/null -w "%{http_code}" https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site/
curl -s -o /dev/null -w "%{http_code}" https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site/api/session
curl -s -o /dev/null -w "%{http_code}" https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site/teacher-login
```

## 4. 说明与边界

- `pnpm lint` 在当前工作区需要 ESLint 忽略 `outputs/**`（R1F-01）后才是 0
  error；R1 复核时源码范围 lint 通过。
- 带认证生产 smoke 因生产凭据不可安全读取仍为 BLOCKED，本文件不把未执行项
  伪造成 PASS；公开 smoke 三项全部通过。
- 线上 D1 migration 直接验证、部署记录与备份纪律分别由 R1F-05 / R1F-06 /
  R1F-16 闭环。
