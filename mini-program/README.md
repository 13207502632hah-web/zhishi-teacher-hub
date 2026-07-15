# 来写作业吧微信小程序一期

本项目与教师网站共用 D1 和 R2，可在无正式 AppID 时使用微信开发者工具的测试 AppID进行本地验收。它不是已经提交审核或正式发布的小程序。

## 本地开发者工具

1. 在网站本地环境设置 `WECHAT_TEST_MODE=true`；生产环境禁止开启，必须保持 `false`。
2. 启动网站开发服务，默认 API 为 `http://localhost:3000`。
3. 在微信开发者工具导入本目录，测试身份可选择学生、家长或教师。
4. 学生/家长输入网站生成的邀请码后，必须回到网站“小程序设置”确认绑定。
5. 依次验证网站发布、下拉同步、多附件上传、失败重试、最终提交、批改草稿、确认回传和订正版本。

`config.js` 统一管理 API 地址：`develop` 使用本地地址，`trial` / `release` 使用 HTTPS 生产域名。需要单独的体验版测试域名时，可在开发者工具缓存中设置 `mini-api-base`，不要在各页面拼接地址。

## 正式接入前

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

自动化不会读取 `.env.local`，本地 Worker 只从被 Git 忽略的 `.dev.vars` 读取 `WECHAT_TEST_MODE=true`。模拟器不能完整代替相机、相册、微信授权和弱网真机验收。
