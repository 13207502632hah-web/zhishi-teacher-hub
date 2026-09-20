# 试卷导入修复与实测记录（2026-09-20）

## 实测证据

- 定心卷题卷 8 页、答案卷 4 页，原任务停在 3/12 页；任务尚未入库。
- 原模型首页仅识别 1、2 题，原图还包含第 3、4 题。
- MiMo 文本连通性探测约 39 秒返回 HTTP 500；同账号 Kimi 文本探测约 2.2 秒成功。
- Kimi 首页原文提取约 16 秒返回 1–4 题；第 4 页约 31.9 秒返回 14–19 题。原 25 秒限时会中止正常响应。

## 修改文件与用途

| 文件 | 修改 |
| --- | --- |
| `app/lib/v2/job-service.ts` | 显式重试重置耗尽次数、取消标记、等待时间和租约，保留断点；同一操作编号不重复重置 |
| `app/api/v2/jobs/[id]/route.ts` | 网站重试统一调用恢复逻辑，并校验操作编号 |
| `app/api/v2/questions/imports/automation/route.ts` | 现有题库专用自动化入口支持原任务重试，限制题库任务并记录审计 |
| `app/v2/approvals/ApprovalCenter.tsx` | 重试请求携带操作编号，未改布局 |
| `app/v2/schedule-imports/ScheduleWorkspace.tsx` | 共用重试调用补充操作编号，未改课表业务或布局 |
| `app/lib/v2/ai-router.ts` | 支持提取任务显式关闭推理；即使 JSON 可解析也拒绝截断输出 |
| `app/lib/v2/background-dispatch.ts` | 租约延长至 120 秒，覆盖完整单页请求 |
| `app/lib/v2/question-import-service.ts` | 逐页原文提取，不推测教材标签；保留页末未完题；单页限时 60 秒；合并后核对答案题号，拦截漏题 |
| `tests/v2-background-jobs.test.mjs` | 验证失败/取消恢复、断点保留、重复操作与跨账号边界 |
| `tests/question-import-pages.test.mjs` | 验证缺题对账、截断拒绝、提取请求与跨页续接 |
| `tests/question-import-automation.test.mjs` | 更新逐页协议和执行时间契约 |

线上识别配置拟切换为已实测可用的 `kimi-k2.6`。未增加依赖、数据库迁移或人工复核步骤。

## 提交前检查

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `node --test tests/*.test.mjs`：440/440 通过（使用本轮生产构建）。
- `git diff --check`：通过。
- 相关页面手动测试、浏览器控制台、移动布局：未完成，浏览器连接服务返回 `nodeRepl.fetch request failed`，未绕过或伪造验收结果。

## 尚待线上核对与风险

- 修复发布后仍需重试原任务，并核对 32 题、32 份答案及跨页选项。
- 模型输出具有不确定性；题号对账能发现相对答案卷的漏题，不能证明所有图文和答案语义均正确。
- 本轮不宣称关闭页面后的后台调度已经验证；需另行检查托管环境定时任务交付。
- 技能托管目录在本轮中途不可读；本地构建成功，若打包辅助脚本仍缺失，按发布接口提供的远程构建方式交付。
