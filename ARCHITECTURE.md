# 知师研室产品与技术架构

## 页面与路由

| 模块 | 路由 | 实现状态 |
| --- | --- | --- |
| 工作台 | `/workspace` | 今日课程、待办、本周概览、关注学生、快捷入口、近期动态 |
| 课时记录 | `/v2/modules/students?view=lessons`、`/v2/detail/lessons/[id]` | V2 列表/周历/月历、搜索筛选、新建编辑、课前—课堂—作业—反馈—反思时间线、完成/撤销、AI 调课与备课、费用、冲突提示和打印；旧列表与详情已退役 |
| 作业中心 | `/v2/modules/assignments` | 班级或指定学生草稿、课时/试卷/附件、组合筛选、收交、AI 批改建议、私密批改草稿与订正；发布和批改结果经审批，写入使用稳定 `operationId` 幂等；旧作业页已退役 |
| 课程反馈 | `/v2/modules/learning?view=feedback` | 单节/阶段反馈、真实证据汇总、AI 可恢复草稿、确认、复制、打印与发送审批；旧反馈页已退役 |
| 反馈反向解析 | `/v2/operations?tab=imports` | 粘贴文字或本机 OCR，逐项核对后经审批建立课时草稿 |
| 智能课表导入 | `/v2/schedule-imports` | 表格/图片/PDF 识别、逐行校对、后台续跑、错误报告与安全撤销 |
| Apple 日历 | `/calendar` | 课时日历视图与外部日历集成 |
| 学生与班级 | `/v2/modules/students`、`/v2/detail/students/[id]`、`/v2/detail/classes/[id]` | V2 学生筛选、证据型重点关注、完整录入、掌握度、趋势、错题、月报和智能订正；班级支持筛选、录入、归档、成员关系、课时与教学证据；旧学生和班级页面均已退役 |
| 测验与成绩 | `/assessments` | 测验项目与成绩记录 |
| 考试项目 | `/exam-projects` | 考试项目规划与结果追踪 |
| 答题卡校对 | `/v2/operations?tab=recognition` | 私有上传、AI 识别草稿、逐题人工校对与正式确认 |
| 学年晋升 | `/academic-years` | 学年切换与学生年级晋升 |
| 题库与组卷 | `/v2/questions`、`/v2/modules/papers`、`/v2/detail/papers/[id]` | 智能检索与完整题库管理双工作区；多格式后台拆题、Word 四步可恢复校对、重复检测、保存筛选、批量标签/知识点、标记、课时关联与选题；组卷支持选题篮恢复、结构化筛选、自动推荐、整卷归档、草稿自动保存、Word/PDF 导出和 AI 结构质检，试卷作业发布统一审批；旧题库和旧组卷页面均已退役 |
| 教学反思 | `/v2/modules/learning?view=reflections` | 私密反思、真实课时证据、AI 独立草稿、日历/筛选、行动与私有策略沉淀；旧页面已退役 |
| 数据中心 | `/v2/modules/learning?view=analytics` | 周/月/学期聚合证据、来源与计算口径；数据不足不输出结论；旧页面已退役 |
| 资源中心 | `/resources`、`/resources/[id]` | 公开可访问；匿名只读公开资源，私有资源按角色展示，详情页不泄露私有资源存在性 |
| 课时结算 | `/v2/modules/finance` | 真实课时月度核对、规则重算、审批后入账、实收登记与鉴权导出；旧页面已退役 |
| 设置 | `/v2/settings` | 角色与账号、助教班级授权、小程序绑定、AI 路由与隐私、演示数据一键创建/清除、导出、删除与审计日志 |
| 微信小程序 | `/v2/settings` | 学生与家长唯一业务入口；支持绑定、邀请、停用和会话撤销，客户端位于 `mini-program/` |

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
- 教师全权限；助教必须被逐班授权后才可协助课时、学生、作业与反馈，且不能导出或查看监护人联系方式；学生、家长只使用小程序，网站不建立学生或家长会话。
- 真实姓名、监护人联系方式、评价记录按敏感数据处理；列表不展示联系方式。
- 删除、导出、批量修改必须二次确认；创建、修改、删除、导出进入审计日志。
- 演示内容以“【演示】”标记并可在设置中一键清除；无真实记录时显示空状态，不生成虚构统计。
- 题目导入先检测重复，再进入“待校对”；只有每道题的人工复核标记均已完成，才能进入正式题库。
- 网站和微信小程序共用 D1/R2 与 `app/lib/services/*` 统一领域服务；小程序不维护独立业务数据库。
- 小程序绑定采用“邀请码申请—教师确认”两步流程；停用后旧会话在下一次请求立即失去学生数据权限。
- 作业发布、最终提交和确认批改使用稳定 `operationId` 幂等；同步游标由服务端 `sync_events.id` 生成。
- 详细关系、权限矩阵和无 AppID 测试方式见 `docs/mini-program-integration.md`。
