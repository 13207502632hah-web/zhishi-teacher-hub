# 每周循环课表：实现与验收记录

## 范围与使用规则

莫老师已确认：起止日期之间每周固定时间重复；临时调整仅影响当次，也可选择本次及后续课次。先实现一个固定周时段的一份课表，不引入新依赖或改写无关模块。

入口：`/v2/schedule-imports`。原文件导入保留在 `?view=imports`；课时列表增加循环排课入口。可以不选班级单独排课，也可跳转单节课新建。

- 起止日期包含边界，最多两年；节假日不自动跳过，可以按次停课。
- 预览实际日期、时间、课程及冲突后确认保存。
- 调课保留课时 ID，因此原课时的备课、作业及记录关联不变。
- 后续批量调整按原始课次顺序选择，整段平移日期，不改变课次数，末次可能超过原结束日。界面明确提示并展示预览。
- 已完成、停课、财务锁定及其他单独调整过的课次保留；选中的单次例外可由教师再次主动修改。
- 停课保留记录，不是删除；目前未提供恢复停课按钮。
- 同一教师工作室所有非取消课时用于时间冲突检查，避免老师重复占时。

## 文件与改动

| 文件 | 改动 |
| --- | --- |
| `app/lib/weekly-schedule.ts` | 纯日期计算、固定周课次展开、跨月周范围 |
| `app/lib/services/weekly-schedule-service.ts` | 预览、权限、冲突、幂等提交、原子写入和审计 |
| `app/api/v2/lesson-series/route.ts` | 循环课表列表及预览/确认接口 |
| `app/v2/schedule-imports/WeeklyScheduleWorkspace.tsx` | 创建、单次/后续调课、停课、预览确认界面 |
| `app/v2/schedule-imports/weekly-schedule.module.css` | 桌面及手机布局 |
| `app/v2/schedule-imports/page.tsx` | 周课表与文件导入入口 |
| `app/v2/modules/[slug]/LessonOverviewWorkspace.tsx` | 排课入口；修复周日历跨月查询缺课 |
| `app/api/v2/lessons/[id]/route.ts` | 普通课时编辑也标记为单次例外 |
| `app/lib/v2/approval-executor.ts` | 经审批调课也标记为单次例外 |
| `db/schema.ts` | 系列、课次映射、幂等回执三个表 |
| `drizzle/0038_weekly_schedules.sql` | 仅增加上述三个表及索引，不改旧数据 |
| `drizzle/meta/_journal.json`、`drizzle/meta/0021_snapshot.json` | 新增迁移登记及当前完整 schema 快照 |
| `scripts/init-local-d1.mjs` | 已有本地环境补齐新表 |
| `app/api/v2/settings/export/route.ts` | 备份包含循环课表和回执 |
| `app/api/v2/settings/data/route.ts` | 用户明确清空工作室时包含循环课表；本轮未执行清空 |
| `tests/weekly-schedule.test.mjs` | 日期、真实 SQLite 事务、幂等、权限、异常保留、财务锁定及备份清理覆盖 |
| `tests/rendered-html.test.mjs` | 将已废弃的人工复核/旧界面断言对齐自动入库规则；正式题目修改/删除审批断言保留 |

## 验收

- 全量 `node --test --test-reporter=tap tests/*.test.mjs`：426/426 通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 全部通过（退出码 0）。
- 本地真实网页、D1 接口闭环：生成四周共 4 节，单次调整 1 节，后续修改 3 节并保留之前例外 1 节，停课 1 节仍保留 4 条记录。
- 原课时接口能读取这 4 节；周日历实际显示跨月的 10 月 1 日测试课。
- 手机宽度 390 像素，两处页面均无横向溢出；网页无 JavaScript 或控制台 error。
- `.artifacts/weekly-desktop.png`、`.artifacts/weekly-mobile.png` 为本地测试截图；`.artifacts/weekly-ui-qa.cjs` 为本地演练脚本。
- 网页演练数据仅写入本地库，测试后按记录 ID 清理测试课时；不混入生产库。
- 新迁移已在本地 D1 成功执行；事务测试模拟中途插入失败和预览之后新增冲突，确认课表、课次、回执及审计全部回滚。

## 迁移与构建注意

旧 Drizzle journal 只登记到 0020，但项目中 0021–0037 已存在。生成器产生的累积旧差异未重复发布，仅保留本次三个新表为 0038；旧 SQL 未修改。新快照序号由生成器产生，journal 新登记指向 0038。

Sites 通用构建包装器因既有双 lockfile 拒绝执行；保留既有锁文件，改用项目既定 `npm run build`，未安装或升级任何依赖。打包采用 Sites 官方 helper 的 Windows Git Bash 调用。

## 未完成与风险

- 线上题库当前仍返回托管层 `chatgpt.site` 拦截页。本轮没有向线上导入新增试题，不能用本地成功冒充线上完成。
- 线上登录态课表闭环尚未验证，发布成功与大陆手机访问正常是两项不同验收。
- 已有循环课表列表暂只展示最近 100 份；单份最多两年，每份一个固定周时段。
- 此次没有做 AI 自动改课、法定节假日自动停课或多教师同时授课；确认后落库，避免模型自行改动正式课表。

设计参考采用成熟的系列与单次例外模式：[Google Calendar recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)，实现保持当前数据库与权限体系。

使用 Skills：Sites Building 用于沿现有工程实现及网页验证；Sites Hosting 用于保留现有受众、打包和正式发布。
