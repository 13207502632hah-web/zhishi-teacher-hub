"use client";

import Link from "@/app/components/HardNavigationLink";
import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { BRAND_EDITION, BRAND_NAME, BRAND_SUBJECT, PUBLIC_TEACHER_SPACE } from "./lib/brand";
import { EmptyState, MetricCard, Panel, StatusBadge } from "./components/ui/Primitives";
import { taskDueLabel } from "./lib/display-format";
import { HttpError, requestJson } from "./lib/http-client";

type LessonCard = Record<string, unknown> & { id: number; date: string; status: string };
type DashboardData = {
  today: string;
  horizonDays: number;
  horizonDate: string;
  weekLessons: number;
  draftLessons: number;
  confirmedFeedback: number;
  pendingFeedback: number;
  attendanceRate: number | null;
  homeworkRate: number | null;
  pendingHomework: number;
  riskCount: number;
  pendingReview: number;
  postLessonTodos: number;
  pendingFinance: number;
  reviewIssues: { missingAnswer: number; missingAnalysis: number; missingClassification: number; lowConfidence: number };
  activeClasses: number;
  activeStudents: number;
  todayLessons: LessonCard[];
  upcomingLessons: LessonCard[];
  overdueLessons: LessonCard[];
  nextLesson: LessonCard | null;
  suggestedActions: Array<{ key: string; type: string; title: string; reason: string; dueAt: string; href: string }>;
  recentQuestions: Array<Record<string, unknown>>;
  aiAvailable: boolean;
  aiPendingFeedbackDrafts: number;
  aiPendingQuestionReviews: number;
  aiMonthCalls: number;
  aiMonthTokens: number;
  aiMonthCost: number;
};

const empty: DashboardData = {
  today: "", horizonDays: 7, horizonDate: "",
  weekLessons: 0, draftLessons: 0, confirmedFeedback: 0, pendingFeedback: 0, attendanceRate: null, homeworkRate: null,
  pendingHomework: 0, riskCount: 0, pendingReview: 0, postLessonTodos: 0, pendingFinance: 0,
  reviewIssues: { missingAnswer: 0, missingAnalysis: 0, missingClassification: 0, lowConfidence: 0 },
  activeClasses: 0, activeStudents: 0, todayLessons: [], upcomingLessons: [], overdueLessons: [], nextLesson: null, suggestedActions: [], recentQuestions: [], aiAvailable: false, aiPendingFeedbackDrafts: 0, aiPendingQuestionReviews: 0, aiMonthCalls: 0, aiMonthTokens: 0, aiMonthCost: 0,
};

const truthy = (value: unknown) => Number(value || 0) > 0;

function WorkflowChips({ lesson }: { lesson: LessonCard }) {
  const members = Number(lesson.memberCount || 0), attendance = Number(lesson.attendanceCount || 0);
  const chips = [
    ["备课", truthy(lesson.prepReady)],
    ["上课", members === 0 || attendance >= members],
    ["作业", truthy(lesson.assignmentCount)],
    ["反馈", truthy(lesson.feedbackCount)],
    ["结算", Boolean(lesson.financeStatus)],
  ] as const;
  return <div className="workflowChips">{chips.map(([label, done]) => <span className={done ? "done" : "pending"} key={label}>{done ? "✓" : "○"} {label}</span>)}</div>;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData>(empty), [loading, setLoading] = useState(true), [paperCart, setPaperCart] = useState(0), [days, setDays] = useState(7);
  const [dashboardError, setDashboardError] = useState(""), [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    try { setPaperCart((JSON.parse(localStorage.getItem("zhishi:paper-cart") || "[]") as number[]).length); } catch { setPaperCart(0); }
    setLoading(true);
    setDashboardError("");
    void requestJson<DashboardData>(`/api/dashboard?days=${days}`, { signal: controller.signal })
      .then((payload) => {
        if (!payload) throw new HttpError(200, "工作台返回了空数据，请重新读取");
        setData(payload);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDashboardError(error instanceof HttpError ? error.message : "暂时无法读取工作台，请稍后重试");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, retryKey]);
  const today = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const nextLesson = data.nextLesson;
  return <AppShell title="今日教学工作台" subtitle="从今日课程出发，完成备课、上课、作业、反馈与结算" actions={<><Link href="/schedule-imports" className="secondaryButton">导入课表</Link><Link href="/lessons?new=1" className="primaryButton">＋ 新建课时</Link></>}>
    {loading && <div className="dashboardLoading" role="status"><span aria-hidden="true" /><div><b>正在读取今日教学安排</b><p>课时、待办和教学数据正在同步。</p></div></div>}
    {dashboardError && <div className="dashboardError" role="alert"><div><b>工作台暂时无法读取</b><p>{dashboardError}。{data.today ? "已显示上次成功读取的内容" : "请重新读取教学安排"}，不会把错误当作零数据。</p></div><button type="button" onClick={() => setRetryKey((value) => value + 1)}>重新读取</button></div>}

    <section className="todayTeachingHero">
      <div className="todayTeachingHero__copy">
        <p>{today}</p>
        <h2>{data.todayLessons.length ? `今天有 ${data.todayLessons.length} 节课` : "今天暂未安排课程"}</h2>
        <span>{nextLesson ? `下一项：${String(nextLesson.date || "今天")} · ${String(nextLesson.displayTitle || nextLesson.topic || nextLesson.courseName || "未填写课题")}` : "可以整理题库、继续校对，或安排新的课时。"}</span>
        <ol className="dashboardTeachingLoop" aria-label="教学闭环">
          {teachingLoop.map((step) => <li key={step.label}><span>{step.number}</span><b>{step.label}</b></li>)}
        </ol>
      </div>
      <div className="todayTeachingMetrics">
        <article><b>{data.todayLessons.length}</b><span>今日课程</span></article>
        <article><b>{data.upcomingLessons.length}</b><span>未来{days}天</span></article>
        <article className={data.overdueLessons.length ? "attention" : ""}><b>{data.overdueLessons.length}</b><span>逾期待处理</span></article>
        <article><b>{data.postLessonTodos}</b><span>课后待补</span></article>
      </div>
    </section>

    <Panel className="dailyPriorityPanel" eyebrow="按临近程度排列" title="今天建议先完成的3件事" description="只根据已有课时、作业、反馈、结算和教师确认记录">
      {data.suggestedActions.length ? <div className="dailyPriorityList">{data.suggestedActions.map((item, index) => <Link href={item.href} key={item.key}><b>{index + 1}</b><div><strong>{item.title}</strong><span>{item.reason}</span></div><time>{taskDueLabel(item.dueAt, data.today)}</time></Link>)}</div> : <EmptyState title="当前没有紧急待办" description="可以继续整理题库、准备后续课程或核对学生档案。" />}
    </Panel>

    <div className="teachingDashboard">
      <Panel className="dashboardTodayPanel" eyebrow="今天先做什么" title="今日课程" actions={<Link href="/lessons">打开课时日历</Link>}>
        {data.todayLessons.length === 0 ? <EmptyState title="今天还没有课程" description="可以从课表导入或新建一节真实课程。" action={<Link className="secondaryButton" href="/schedule-imports">导入课表</Link>} /> : <div className="todayWorkflowList">{data.todayLessons.map((lesson) => <article key={lesson.id}><time>{String(lesson.startTime || "待定")}<small>{String(lesson.endTime || "")}</small></time><div className="workflowLesson"><StatusBadge tone={lesson.status === "completed" ? "success" : "warning"}>{lesson.status === "completed" ? "已完成" : "待记录"}</StatusBadge><h3>{String(lesson.topic || lesson.courseName || "未填写课题")}</h3><p>{String(lesson.className || "未关联班级")} · {String(lesson.location || (lesson.mode === "online" ? "线上" : "地点待补"))}</p><WorkflowChips lesson={lesson} /></div><Link className="primaryButton" href={`/lessons/${lesson.id}`}>{lesson.status === "completed" ? "查看记录" : "开始记录"}</Link></article>)}</div>}
      </Panel>

      <Panel className="dashboardUpcomingPanel" eyebrow="未来安排" title={`未来${days}天`} actions={<Link href="/lessons">全部课时</Link>}>
        <div className="rangeSwitch" aria-label="未来课时范围">{[7,14,30].map((value) => <button className={days === value ? "active" : ""} onClick={() => setDays(value)} key={value}>{value}天</button>)}</div>
        {data.upcomingLessons.length ? <div className="upcomingLessonList">{data.upcomingLessons.map((lesson) => <Link href={`/lessons/${lesson.id}`} key={lesson.id}><time>{String(lesson.date).slice(5)}<small>{String(lesson.startTime || "待定")}</small></time><div><b>{String(lesson.topic || lesson.courseName || "未填写课题")}</b><span>{String(lesson.className || "未关联班级")}</span></div></Link>)}</div> : <EmptyState title={`未来${days}天暂无课程`} description={nextLesson ? `下一节课是 ${String(nextLesson.date).slice(5)} ${String(nextLesson.startTime || "待定")}，仍可提前进入备课。` : "后续课程会按日期自动出现在这里。"} action={nextLesson ? <Link className="secondaryButton" href={`/lessons/${nextLesson.id}`}>打开下一节课</Link> : undefined} />}
      </Panel>

      <Panel className="dashboardTodoPanel" eyebrow="教学闭环" title="集中待办">
        <ul className="todoList"><li><Link href="/lessons?focus=post&status=scheduled">逾期待完成课时</Link><b>{data.overdueLessons.length}</b></li><li><Link href="/feedback?status=draft">待确认反馈</Link><b>{data.pendingFeedback}</b></li><li><Link href="/assignments?submissionStatus=pending">待批改作业</Link><b>{data.pendingHomework}</b></li><li><Link href="/finance?status=review">待核对结算</Link><b>{data.pendingFinance}</b></li><li><Link href="/students?attention=weekly">待跟进学生</Link><b>{data.riskCount}</b></li></ul>
      </Panel>
    </div>

    <section className="questionWorkbenchCompact"><div><p>{BRAND_SUBJECT}题库与组卷</p><h2>备课需要题目时，从这里继续</h2><span>原文优先、人工校对、教材目录检索；系统不会替您补写答案或知识点。</span></div><div className="questionWorkbenchActions"><Link href="/questions?import=1"><b>01</b><span>导入 Word</span><small>多 DOCX 队列</small></Link><Link href="/questions?status=review"><b>02</b><span>继续校对</span><small>{data.pendingReview} 道待处理</small></Link><Link href="/questions"><b>03</b><span>搜索题目</span><small>目录、关键词、标签</small></Link><Link href="/papers"><b>04</b><span>开始组卷</span><small>{paperCart} 道已加入草稿</small></Link></div></section>

    {data.aiAvailable && <section className="aiWorkbenchCompact"><div><p>教师专属辅助</p><h2>DeepSeek：只做草稿和建议</h2><span>所有结果先由教师确认；用量为当前教师本月真实服务端统计。</span></div><div className="questionWorkbenchActions"><Link href="/feedback"><b>{data.aiPendingFeedbackDrafts}</b><span>待处理 AI 反馈草稿</span><small>可恢复、逐项核对</small></Link><Link href="/questions?status=review"><b>{data.aiPendingQuestionReviews}</b><span>待确认题库建议</span><small>安全字段与敏感字段分开</small></Link><Link href="/settings"><b>{data.aiMonthCalls}</b><span>本月 AI 用量</span><small>{data.aiMonthTokens.toLocaleString()} Token · ${data.aiMonthCost.toFixed(4)}</small></Link></div></section>}

    <div className="dashboardMetricGrid">
      <MetricCard label="本周课时" value={data.weekLessons} detail="真实教学安排" />
      <MetricCard label="出勤率" value={data.attendanceRate == null ? "—" : `${data.attendanceRate}%`} detail="仅统计已记录出勤" />
      <MetricCard label="学生档案" value={data.activeStudents} detail={`${data.activeClasses} 个进行中班级`} />
      <MetricCard label="组卷篮" value={paperCart} detail="刷新后仍可继续组卷" />
    </div>
  </AppShell>;
}

const teachingLoop = [
  { number: "01", label: "备课", note: "目标、重难点与题目" },
  { number: "02", label: "上课", note: "课堂过程与学生表现" },
  { number: "03", label: "作业", note: "任务、提交与批改" },
  { number: "04", label: "反馈", note: "教师确认后再发送" },
  { number: "05", label: "结算", note: "课时依据清晰可查" },
];

export default function PublicHome() {
  return <AppShell title={BRAND_NAME} publicLanding>
    <section className="publicHomeHero">
      <div className="publicHomeHero__copy">
        <p className="publicHomeEyebrow"><span>{PUBLIC_TEACHER_SPACE}</span><i aria-hidden="true" /></p>
        <h1>把一节课，做成<br />可积累的教学资产。</h1>
        <p className="publicHomeLead">从备课、上课到作业、反馈与结算，把真实教学过程安静地收进一个工作台。数据归教师管理，重要结果始终由教师确认。</p>
        <div className="publicHomeActions">
          <Link className="publicHomePrimary" href="/teacher-login?return_to=%2Fworkspace">教师登录 <span aria-hidden="true">→</span></Link>
          <Link className="publicHomeSecondary" href="/resources">浏览公开资源</Link>
        </div>
        <ul className="publicHomeTrust" aria-label="工作台原则">
          <li>私人数据不公开</li>
          <li>教师确认后生效</li>
          <li>初高中{BRAND_SUBJECT}教学</li>
        </ul>
      </div>

      <div className="publicHomeDesk" aria-label="一节课的教学闭环示意">
        <div className="publicHomeDesk__folio">{BRAND_NAME} · {BRAND_EDITION}</div>
        <div className="publicHomeDesk__heading">
          <div><span>今日课题</span><strong>理解权利与义务</strong></div>
          <span className="publicHomeDesk__sample">示例课时<br />教学手记</span>
        </div>
        <ol className="publicHomeLoop">
          {teachingLoop.map((step, index) => <li key={step.label}>
            <span>{step.number}</span>
            <div><b>{step.label}</b><small>{step.note}</small></div>
            {index < teachingLoop.length - 1 && <i aria-hidden="true" />}
          </li>)}
        </ol>
        <div className="publicHomeDesk__note"><span aria-hidden="true">批</span><p>系统可以整理草稿，教学判断由教师完成。</p></div>
      </div>
    </section>

    <section className="publicHomePrinciples" aria-labelledby="public-principles-title">
      <div className="publicHomeSectionHead">
        <p>不是再多一个工具</p>
        <h2 id="public-principles-title">让日常教学留下可复用的脉络</h2>
      </div>
      <div className="publicHomePrincipleGrid">
        <article><span>一</span><h3>从今天的课开始</h3><p>先处理临近课程和真实待办，不要求一次补齐所有历史资料。</p></article>
        <article><span>二</span><h3>题目有出处，反馈有依据</h3><p>保留题目原文和校对状态；生成内容先作为草稿，由教师决定是否采用。</p></article>
        <article><span>三</span><h3>学生信息保持私密</h3><p>公开资源与班级、学生、评价严格分开，权限在服务端再次核验。</p></article>
      </div>
    </section>

    <section className="publicHomeResource">
      <div><p>公开阅览室</p><h2>想先看看？从教学资源开始。</h2><span>公开资源无需登录；课时、学生、反馈和结算只在教师工作台中显示。</span></div>
      <Link href="/resources">进入公开资源中心 <span aria-hidden="true">↗</span></Link>
    </section>
  </AppShell>;
}
