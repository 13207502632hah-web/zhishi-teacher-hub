# 安全说明

## 身份与登录

- 教师管理员账号密码通过 `TEACHER_ADMIN_ACCOUNT` /
  `TEACHER_ADMIN_PASSWORD` 配置；首次校验通过后，密码以 PBKDF2（SHA-256，
  210000 次迭代）哈希写入 D1 的 `teacher_admin_credentials`。
- 修改密码会使 `session_version` 递增，旧会话立即失效。
- 会话使用 HMAC 签名 Cookie：`HttpOnly`、`Secure`、`SameSite=Lax`，
  有效期 12 小时。
- 登录失败超过 5 次后，该来源 IP 锁定 15 分钟；限流只信任 Cloudflare
  提供的 `cf-connecting-ip`，不回退到客户端可伪造的 `x-forwarded-for`。

## 授权

- 默认单教师工作区；首位登录用户初始化为教师，后续账号由教师在设置中分配角色。
- 助教必须被逐班授权（`staff_class_access`）后才能协助课时、学生、作业与
  反馈，且不能导出或查看监护人联系方式。
- 学生、家长只进入只读门户，服务端仍按关联关系校验数据归属。
- 资源中心可公开访问；其余页面与接口要求登录，并在服务端检查权限。

### 当前 Web 登录边界

当前 Web 登录只产生教师管理员会话（`teacher-admin@local.invalid` +
`TEACHER_ADMIN_*` 配置）；`app/lib/access.ts` 中声明的助教/学生/家长角色
尚未通过 Web 登录接通，小程序使用独立的 `MiniAccess` 会话且当前暂停。
下面矩阵描述的是声明层与服务端校验应遵循的边界，不是当前 Web 可登录角色。

### 权限矩阵

| 角色 | 可访问页面/接口 | 权限点 | 说明 |
| --- | --- | --- | --- |
| teacher | 全部工作台页面与 API | `*` | 当前唯一可通过 Web 登录进入的角色；可管理账号、班级授权、演示数据与危险操作 |
| assistant | dashboard、classes、students、lessons、questions、papers、feedback、resources 等已声明模块 | `dashboard:read`、`classes:read`、`students:read`、`lessons:read/write`、`questions:read/write`、`papers:read/write`、`feedback:read/write`、`resources:read/private/write` | 无 `analytics:read` 与 `academic-years:*`；访问 `/assessments`、`/exam-projects`、`/recognition`、`/finance`、`/academic-years` 的 API 会 403，导航已同步隐藏这些入口 |
| student | `/portal` 只读 | `portal:read`、`resources:read` | 服务端按本人关联关系校验数据归属 |
| parent | `/portal` 只读 | `portal:read`、`resources:read` | 仅可查看已确认且与本人关联的内容 |
| anonymous | 登录页、公开资源入口与 `auth/login` 等公开接口 | 无 | 其余页面返回登录重定向，受保护 API 返回 401 |

## 数据保护

- 真实姓名、监护人联系方式与评价记录按敏感数据处理，列表不展示联系方式。
- 删除、导出、批量修改必须二次确认；创建、修改、删除、导出进入审计日志。
- 演示内容以“【演示】”标记并可在设置中一键清除；无真实记录时显示空状态，
  不生成虚构统计。
- 私有文件通过服务端权限校验后返回，使用 `private, no-store` 缓存策略。

## 幂等与防重复

- 作业发布、最终提交、确认批改和结算确认使用稳定 `operationId` 幂等。
- 结算确认必须回传 preview 生成的 `previewToken`；令牌签名绑定操作编号、
  课时、付款方与计算指纹，有效期 5 分钟，内容变化或令牌缺失返回 409。
- 重复结算写入使用 `INSERT OR IGNORE` 与状态条件更新，避免覆盖已确认账目。

## AI 与第三方

- AI 结果只生成草稿与建议，全部需要教师确认后才能落库；敏感字段（如解析）
  与安全字段分开审核。
- AI 请求只发送最小化字段，学生姓名默认匿名；教师可在设置中显式开启包含
  学生姓名，并受每日用量限制。
- OCR 供应商密钥与微信密钥只存在于本地 `.dev.vars` 或平台 Secret，不进入
  浏览器代码。

## 部署

- 生产环境不提交 `.dev.vars`、`.env*` 或任何密钥文件。
- 生产必须保持 `WECHAT_TEST_MODE=false`；微信小程序当前暂停，不参与发布。
- 修改密码、角色或班级授权等敏感操作均写入审计日志，可在设置中查看。
