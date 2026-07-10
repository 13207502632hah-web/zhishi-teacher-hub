# 知师研室产品与技术架构

## 页面与路由

| 模块 | 路由 | 第一阶段状态 |
| --- | --- | --- |
| 工作台 | `/` | 实现：今日课程、待办、本周概览、关注学生、快捷入口、近期动态 |
| 课时记录 | `/lessons` | 实现：列表、搜索、筛选、新建、编辑、删除、复制、完成、打印 |
| 课时详情 | `/lessons/[id]` | 实现：课前—课堂—作业—反馈—反思时间线 |
| 学生与班级 | `/classes`、`/students` | 实现：班级与学生基础档案、筛选、隐私最小展示 |
| 题库与组卷 | `/questions`、`/papers` | 第二阶段；保留 Word 四步导入入口 |
| 课程反馈 | `/feedback` | 第三阶段 |
| 教学反思 | `/reflections` | 第三阶段 |
| 数据中心 | `/analytics` | 第三阶段；无数据时只显示数据不足提示 |
| 资源中心 | `/resources` | 保留原品牌首页与资源展示 |
| 设置 | `/settings` | 第四阶段：角色、导出、删除与审计配置 |

## 组件清单

- `AppShell`：侧边导航、移动端顶部栏、当前页面定位。
- `Dashboard`：今日课程、待办、本周指标、关注学生、快捷入口、动态流。
- `LessonList`、`LessonForm`、`LessonTimeline`：课时检索、编辑与详情闭环。
- `ClassCard`、`ClassForm`、`StudentList`、`StudentProfile`：班级和学生档案。
- `EmptyState`、`MetricCard`、`StatusBadge`、`ConfirmDialog`：通用状态与安全确认。
- 第二阶段：`QuestionEditor`、`ImportWizard`、`QuestionReview`、`PaperBuilder`。
- 第三阶段：`FeedbackEditor`、`ReflectionEditor`、`AnalyticsChart`。

## 数据库关系图

```mermaid
erDiagram
  USER ||--o{ USER_ROLE : has
  ROLE ||--o{ USER_ROLE : grants
  USER ||--o{ CLASS : owns
  CLASS ||--o{ ENROLLMENT : contains
  STUDENT ||--o{ ENROLLMENT : joins
  CLASS ||--o{ COURSE : schedules
  COURSE ||--o{ LESSON : contains
  LESSON ||--o{ ATTENDANCE : records
  STUDENT ||--o{ ATTENDANCE : receives
  LESSON ||--o{ STUDENT_LESSON_RECORD : records
  STUDENT ||--o{ STUDENT_LESSON_RECORD : has
  LESSON ||--o{ ASSIGNMENT : assigns
  ASSIGNMENT ||--o{ ASSIGNMENT_SUBMISSION : receives
  STUDENT ||--o{ ASSIGNMENT_SUBMISSION : submits
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

- 默认单教师工作区；教师全权限，助教、学生、家长仅预留最小角色模型。
- 真实姓名、监护人联系方式、评价记录按敏感数据处理；列表不展示联系方式。
- 删除、导出、批量修改必须二次确认；创建、修改、删除、导出进入审计日志。
- 演示内容必须显示“示例数据”；无真实记录时显示空状态，不生成虚构统计。
- 题目导入先进入“待校对”，确认后才能进入正式题库。
