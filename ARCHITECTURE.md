# 知师研室产品与技术架构

## 页面与路由

| 模块 | 路由 | 实现状态 |
| --- | --- | --- |
| 工作台 | `/workspace` | 今日课程、待办、本周概览、关注学生、快捷入口、近期动态 |
| 课时记录 | `/lessons`、`/lessons/[id]` | 列表与日历、搜索筛选、新建编辑、课前—课堂—作业—反馈—反思时间线、完成/取消/调课/补课、费用、时间冲突提示、打印 |
| 作业中心 | `/assignments` | 草稿/发布、班级或指定学生、附件、提交待办、批改确认、订正版本；作业发布与提交使用稳定 `operationId` 幂等 |
| 课程反馈 | `/feedback` | 单节/阶段模板、真实数据汇总、确认、复制与打印 |
| 反馈反向解析 | `/feedback-imports` | 从已有文本反向解析为结构化反馈草稿 |
| 课表导入 | `/schedule-imports` | 课表批量导入、指纹去重、差异预览与提交 |
| Apple 日历 | `/calendar` | 课时日历视图与外部日历集成 |
| 学生与班级 | `/classes`、`/classes/[id]`、`/students` | 班级编辑与归档、学生档案、学校/教材/考试目标、筛选、隐私最小展示 |
| 测验与成绩 | `/assessments` | 测验项目与成绩记录 |
| 考试项目 | `/exam-projects` | 考试项目规划与结果追踪 |
| 答题卡校对 | `/recognition` | 答题卡识别结果的人工校对 |
| 学年晋升 | `/academic-years` | 学年切换与学生年级晋升 |
| 题库与组卷 | `/questions`、`/papers` | Word 四步校对导入、重复检测、批量标签/知识点/状态、检索、标记、组卷、学生版/教师版/答案解析版打印 |
| 教学反思 | `/reflections` | 私密反思、日历、检索、策略沉淀 |
| 数据中心 | `/analytics` | 周/月/学期真实指标；数据不足不输出结论 |
| 资源中心 | `/resources` | 公开可访问；私有资源按角色展示 |
| 课时结算 | `/finance` | 结算预览、预览令牌确认、实收登记、月度汇总与导出 |
| 设置 | `/settings` | 角色与账号、助教班级授权、演示数据一键创建/清除、导出、删除与审计日志 |
| 我的学习 | `/portal` | 门户页面与 API 暂按教师管理员登录保护；学生/家长最小权限视图为产品目标，登录链路未开放 |
| 微信小程序 | `/mini-settings` | 功能暂停中；代码保留在 `mini-program/`，不参与线上发布 |

## 组件清单

- `AppShell`：侧边导航、移动端顶部栏、当前页面定位。
- `Dashboard`：今日课程、待办、本周指标、关注学生、快捷入口、动态流。
- `EmptyState`、`MetricCard`、`StatusBadge`：通用状态、指标与标签。
- `QuestionModal`：题库新增/编辑表单。
- `ResourceError`、`LoadingLine`：数据加载失败与等待状态。
- `ModuleSection`、`Insufficient`、`StudentTrend`、`HomeworkTrend`：数据中心模块化展示与数据不足提示。

## 数据库关系图

```mermaid
erDiagram
  USER ||--o{ USER_ROLE : has
  ROLE ||--o{ USER_ROLE : grants
  USER ||--o{ CLASS : owns
  USER ||--o{ STAFF_CLASS_ACCESS : authorized_for
  CLASS ||--o{ ENROLLMENT : contains
  STUDENT ||--o{ ENROLLMENT : joins
  CLASS ||--o{ COURSE : schedules
  COURSE ||--o{ LESSON : contains
  LESSON ||--o{ ATTENDANCE : records
  STUDENT ||--o{ ATTENDANCE : receives
  LESSON ||--o{ STUDENT_LESSON_RECORD : records
  STUDENT ||--o{ STUDENT_LESSON_RECORD : has
  LESSON ||--o{ ASSIGNMENT : assigns
  ASSIGNMENT ||--o{ ASSIGNMENT_TARGET : targets
  ASSIGNMENT ||--o{ ASSIGNMENT_SUBMISSION : receives
  STUDENT ||--o{ ASSIGNMENT_SUBMISSION : submits
  ASSIGNMENT_SUBMISSION ||--o{ SUBMISSION_VERSION : preserves
  SUBMISSION_VERSION ||--o{ SUBMISSION_ASSET : attaches
  ASSIGNMENT_SUBMISSION ||--o{ SUBMISSION_REVIEW : reviews
  QUESTION_SET ||--o{ QUESTION : groups
  PAPER ||--o{ PAPER_QUESTION : contains
  QUESTION ||--o{ PAPER_QUESTION : selected
  LESSON }o--o{ QUESTION : uses
  ASSESSMENT ||--o{ ASSESSMENT_RESULT : produces
  STUDENT ||--o{ ASSESSMENT_RESULT : receives
  LESSON ||--o{ FEEDBACK : generates
  STUDENT ||--o{ FEEDBACK : receives
  LESSON ||--o{ REFLECTION : inspires
  USER ||--o{ RESOURCE : owns
  USER ||--o{ AUDIT_LOG : performs
```

## 数据与权限原则

- 默认单教师工作区；首位登录用户初始化为教师，后续账号必须由教师在设置中分配角色。
- 资源中心可公开访问；匿名/公开请求只读公开资源，新增、删除与私有范围读写要求教师或已授权助教，并在服务端检查权限。
- 教师全权限；助教必须被逐班授权后才可协助课时、学生、作业与反馈，且不能导出或查看监护人联系方式；学生、家长只进入只读门户。
- 真实姓名、监护人联系方式、评价记录按敏感数据处理；列表不展示联系方式。
- 删除、导出、批量修改必须二次确认；创建、修改、删除、导出进入审计日志。
- 演示内容以“【演示】”标记并可在设置中一键清除；无真实记录时显示空状态，不生成虚构统计。
- 题目导入先检测重复，再进入“待校对”；只有每道题的人工复核标记均已完成，才能进入正式题库。
- 网站和微信小程序共用 D1/R2 与 `app/lib/services/*` 统一领域服务；小程序不维护独立业务数据库。
- 小程序绑定采用“邀请码申请—教师确认”两步流程；停用后旧会话在下一次请求立即失去学生数据权限。
- 作业发布、最终提交和确认批改使用稳定 `operationId` 幂等；同步游标由服务端 `sync_events.id` 生成。
- 详细关系、权限矩阵和无 AppID 测试方式见 `docs/mini-program-integration.md`。
