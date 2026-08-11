# 知师研室 iOS

这是 iOS 17+ 的原生 SwiftUI 客户端源码，包含教师登录、今日概览、移动记录的
新增/编辑/删除、课时关联、共享审批、离线发件箱、跨设备冲突保留和服务器设置。
它直接调用网站的 `/api/auth/*`、`/api/session` 与
`/api/v2/mobile/*`，因此和网页、小程序使用同一套 D1/R2 数据。

当前仓库在 Windows 上生成；请在 macOS 上安装 XcodeGen 后运行：

```bash
cd ios
xcodegen generate
open ZhishiMobile.xcodeproj
```

购买正式域名后，在仓库根目录执行 `npm run release:domain -- 你的域名.cn`；网站、
小程序和 iOS 会一起采用这个 HTTPS 地址，正式版首次启动无需手工输入。发布前把 `project.yml` 中的
`PRODUCT_BUNDLE_IDENTIFIER` 换成 Apple Developer 后台登记的 Bundle ID，并在 Xcode
选择签名 Team。详细资料见 `docs/mobile-release-checklist.md`。正式不透明 AppIcon 已由
`public/app-icon.svg` 生成并接入 `Assets.xcassets/AppIcon.appiconset/AppIcon.png`；如后续
修改品牌图标，应同步重新生成该 1024×1024 PNG。

`PrivacyInfo.xcprivacy` 已声明当前客户端使用的账号标识、教师输入内容和
UserDefaults 原因；接入崩溃分析、推送、统计或新的第三方 SDK 后，发布前必须重新
核对隐私清单和 App Store 隐私问卷。更换 API 地址会退出当前账号，避免把已有会话
静默带到另一个服务器。本机未同步副本可在设置页单独清除。

在任意平台可先执行 `pnpm mobile:check`。它会生成
`.artifacts/mobile/readiness.md`，检查本地三端实现并明确列出只能在 Mac、微信后台或
真机完成的外部事项；该命令不会上传或发布任何版本。
