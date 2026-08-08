# 部署记录

## 2026-08-08 - Sprint P1.1 班级分页/搜索/ClassPicker

- 状态：succeeded
- 生产 URL：https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site
- 代码 SHA：`36fe40248ac941b44ffec00ffcb7fef101290f42`
- Sites 版本：64（`appgver_2f9d03561e948191aaa160a3f5a166cd`）
- 部署 ID：`appgdep_6a7750abe6508191ae491dfd1f047f5e`
- 部署时间：2026-08-08T15:52:23Z
- 环境：D1 `DB`、R2 `FILES`；未修改生产环境变量
- 载荷证据：4300 班级全量 1,233,006 字节；默认页 14,305 字节（-98.8%）；options 3,267 字节（-99.7%）
- 公开 smoke：`/` 200、`/teacher-login` 200、`/api/session` 200 JSON、`/api/classes` 401、`/api/classes/options` 401
- 认证 smoke：BLOCKED（无 `PROD_SMOKE_TEACHER` 生产凭据，不覆盖生产 Secret、不放宽认证）
- 发布结论：READY FOR STAGING

## 2026-08-08 - Sprint P1 课表导入与站点性能收尾

- 状态：succeeded
- 生产 URL：https://zhishi-teacher-hub.jz4hbwctq7.chatgpt.site
- 代码 SHA：`274a43f8bdad92414cb8fee043f605cf9a13c9e1`
- Sites 版本：61（`appgver_fad817e4fd008191a48dbbbd0cb24d46`）
- 部署 ID：`appgdep_6a7731ef2ec48191a49c07a5b9d63b3f`
- 部署时间：2026-08-08T13:41:18Z
- 环境：D1 `DB`、R2 `FILES`；未修改生产环境变量
- 公开 smoke：`/` 200、`/teacher-login` 200、`/api/session` 200 JSON
- 认证 smoke：BLOCKED（无 `PROD_SMOKE_TEACHER` 生产凭据，不覆盖生产 Secret、不放宽认证）
- 发布结论：READY FOR STAGING
