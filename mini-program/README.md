# 知师研室微信小程序一期

> 状态：V2 内部候选版。只面向学生和家长；教师发布、批改和反馈仍在网站完成。
> 当前不执行正式上传、审核或发布，体验版必须在整体验收环境和正式 AppID 下生成。

本项目与教师网站共用 D1 和 R2，可在无正式 AppID 时使用微信开发者工具的测试 AppID进行本地验收。它不是已经提交审核或正式发布的小程序。

## 本地开发者工具

1. 在网站本地环境设置 `WECHAT_TEST_MODE=true`；生产环境禁止开启，必须保持 `false`。
2. 启动网站开发服务，默认 API 为 `http://localhost:3000`。
3. 在微信开发者工具导入本目录，本地合成身份只使用学生或家长。
4. 学生/家长输入网站生成的邀请码后，必须回到网站“小程序设置”确认绑定。
5. 依次验证网站发布与确认、学生/家长下拉同步、多附件上传、失败重试、最终提交、确认结果展示和订正版本。

`config.js` 统一管理 API 地址：`develop` 使用本地地址；缓存中的 `mini-api-base` 只在
开发版生效。体验版命令会在 Git 忽略的一次性副本中，把 `develop` / `trial` /
`release` 全部注入明确传入的 HTTPS 测试域名，正式源码中的占位域名不会误连旧站。

## 体验版接入前

- 当前代码中的测试 HTTPS 地址只用于内部候选环境；中国大陆正式使用前换成已备案的
  自有 HTTPS API 域名，并在微信后台配置合法域名。
- 注册并认证小程序，填写真实 AppID。
- 配置 HTTPS `request`、`uploadFile`、`downloadFile` 合法域名。
- 在托管环境配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，确认生产 `WECHAT_TEST_MODE=false`。
- 准备隐私协议、用户信息处理说明和用户主动授权的订阅消息模板。
- 使用隔离测试账号验证绑定、停用后权限、指定学生作业、私有文件和优秀作业遮罩。

真实密钥、会话令牌和学生资料不得写入本文件、代码、日志或 Git。

## 自动化命令

- `pnpm mini:prepare`：仅准备并核验本地 Miniflare D1，自动备份后补齐缺失迁移。
- `pnpm mini:dev`：准备 D1、启动网站并通过微信开发者工具 CLI 打开本项目。
- `pnpm mini:check`：运行类型、Lint、测试、构建和静态安全检查。
- `pnpm mini:e2e`：使用 `__e2e__` 合成数据完成接口回归和开发者工具模拟器回归。
- `pnpm mini:verify`：依次执行 `mini:check` 与 `mini:e2e`，报告保存在 `.artifacts/mini/`。
- `pnpm mini:preview`：仅在正式 AppID、独立 HTTPS 测试域名和人工确认口令齐备时生成预览码；不会执行上传、审核或发布。
- `pnpm mobile:check`：检查 PWA、iOS、小程序和共享数据契约，并把账号、域名、
  AppIcon、Mac 与真机矩阵等外部待办写入 `.artifacts/mobile/readiness.md`。

自动化不会读取 `.env.local`，本地 Worker 只从被 Git 忽略的 `.dev.vars` 读取 `WECHAT_TEST_MODE=true`。模拟器不能完整代替相机、相册、微信授权和弱网真机验收。
