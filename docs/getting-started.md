# 本地启动指南

## 前置要求

- Node.js `>=22.13.0`，推荐使用 pnpm。
- 首次运行需要网络安装依赖。

## 安装与启动

```bash
pnpm install
pnpm db:init
pnpm dev
```

`pnpm dev` 会先执行 `scripts/prepare-ocr-assets.mjs` 准备浏览器 OCR 运行时，
再通过 vinext 启动本地开发服务器（默认 `http://localhost:3000`）。

## 环境变量

复制 `.env.example` 为 `.dev.vars` 并填写：

- `TEACHER_ADMIN_ACCOUNT`：教师管理员账号。
- `TEACHER_ADMIN_PASSWORD`：教师管理员初始密码，首次登录后可在设置中修改。
- `TEACHER_ADMIN_SESSION_SECRET`：会话与结算预览令牌签名密钥，本地可用任意
  足够长的随机字符串，生产必须使用平台 Secret。

可选配置：

- `DEEPSEEK_API_KEY`、`DEEPSEEK_AI_ENABLED=true`：启用 AI 草稿与建议功能。
- `RECOGNITION_PROVIDER`、`RECOGNITION_API_KEY`：答题卡识别供应商配置。
- `WECHAT_*`：仅本地微信开发者工具预览使用，生产必须保持关闭。

`.dev.vars` 已被 Git 忽略，不要提交真实密钥。生产环境通过 Cloudflare/Sites
Secret 注入，不写入源码或 `hosting.json`。

## 本地数据库

项目使用 Cloudflare D1，本地状态位于 `.wrangler/state/v3/d1/`，由
`drizzle/` 下的迁移初始化。首次安装后执行一次：

```bash
pnpm db:init
```

`db:init` 会确定性地应用全部迁移并校验必需表（含 `teacher_admin_credentials`、
`lessons`、`papers`、`demo_records`），不再依赖“先跑一次 `pnpm dev`”。
修改 `db/schema.ts` 后运行：

```bash
pnpm db:generate
```

生成新迁移后，再执行 `pnpm db:init` 应用迁移。数据库备份与恢复见
[d1-backup.md](d1-backup.md)。

## 常用验证

```bash
pnpm typecheck   # TypeScript 类型检查
pnpm lint        # ESLint 全量检查
pnpm test        # 构建后运行 tests/*.test.mjs
pnpm build       # 生产构建验证
```

教学闭环端到端回归需要本地 D1 可用，且端口 3000 未被占用：

```bash
pnpm teaching:e2e
```

该脚本会临时创建 `.dev.vars.e2e`、启动本地服务器并清理测试数据，结束后写入
`outputs/teaching-loop-e2e.json`。

## 常见问题

- 端口被占用：停止占用 3000 端口的进程后重试，或临时修改 e2e 脚本中的
  `baseUrl` 与对应启动端口。
- 登录提示账号或密码不正确：检查 `.dev.vars` 中教师管理员配置是否已生效，
  修改后需重启 `pnpm dev`。
- 结算确认提示预览失效：结算 confirm 必须回传 preview 返回的
  `previewToken`，且请求体中的 `operationId` 必须与 preview 一致。
