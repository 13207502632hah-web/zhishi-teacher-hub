"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "./components/AppShell";
import ResourcesPage from "./resources/page";

type LessonCard = Record<string, unknown> & { id: number; date: string; status: string };
type DashboardData = {
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
  recentQuestions: Array<Record<string, unknown>>;
};

const empty: DashboardData = {
  weekLessons: 0, draftLessons: 0, confirmedFeedback: 0, pendingFeedback: 0, attendanceRate: null, homeworkRate: null,
  pendingHomework: 0, riskCount: 0, pendingReview: 0, postLessonTodos: 0, pendingFinance: 0,
  reviewIssues: { missingAnswer: 0, missingAnalysis: 0, missingClassification: 0, lowConfidence: 0 },
  activeClasses: 0, activeStudents: 0, todayLessons: [], upcomingLessons: [], overdueLessons: [], recentQuestions: [],
};

const truthy = (value: unknown) => Number(value || 0) > 0;

function WorkflowChips({ lesson }: { lesson: LessonCard }) {
  const members = Number(lesson.memberCount || 0), attendance = Number(lesson.attendanceCount || 0);
  const chips = [
    ["备课", truthy(lesson.prepReady)],
    ["出勤", members === 0 || attendance >= members],
    ["作业", truthy(lesson.assignmentCount)],
    ["反馈", truthy(lesson.feedbackCount)],
    ["结算", Boolean(lesson.financeStatus)],
  ] as const;
  return <div className="workflowChips">{chips.map(([label, done]) => <span className={done ? "done" : "pending"} key={label}>{done ? "✓" : "○"} {label}</span>)}</div>;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData>(empty), [loading, setLoading] = useState(true), [paperCart, setPaperCart] = useState(0);
  useEffect(() => {
    try { setPaperCart((JSON.parse(localStorage.getItem("zhishi:paper-cart") || "[]") as number[]).length); } catch { setPaperCart(0); }
    fetch("/api/dashboard").then((response) => response.ok ? response.json() : empty).then(setData).catch(() => setData(empty)).finally(() => setLoading(false));
  }, []);
  const today = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
  const nextLesson = data.todayLessons.find((lesson) => lesson.status !== "completed") || data.upcomingLessons[0];
  return <AppShell title="今日教学工作台" subtitle="从今日课程出发，完成备课、出勤、作业、反馈与结算" actions={<><Link href="/schedule-imports" className="secondaryButton">导入课表</Link><Link href="/lessons?new=1" className="primaryButton">＋ 新建课时</Link></>}>
    {loading && <div className="noticeStrip"><b>正在读取今日教学安排…</b></div>}

    <section className="todayTeachingHero">
      <div><p>{today}</p><h2>{data.todayLessons.length ? `今天有 ${data.todayLessons.length} 节课` : "今天暂未安排课程"}</h2><span>{nextLesson ? `下一项：${String(nextLesson.date || "今天")} ${String(nextLesson.startTime || "待定")} · ${String(nextLesson.topic || nextLesson.courseName || "未填写课题")}` : "可以整理题库、继续校对，或安排新的课时。"}</span></div>
      <div className="todayTeachingMetrics"><article><b>{data.todayLessons.length}</b><span>今日课程</span></article><article><b>{data.upcomingLessons.length}</b><span>未来七天</span></article><article className={data.overdueLessons.length ? "attention" : ""}><b>{data.overdueLessons.length}</b><span>逾期待处理</span></article><article><b>{data.postLessonTodos}</b><span>课后待补</span></article></div>
    </section>

    <div className="dashboardGrid teachingDashboard">
      <section className="panel span2"><div className="panelTitle"><div><p>今天先做什么</p><h2>今日课程</h2></div><Link href="/lessons">打开课时日历</Link></div>{data.todayLessons.length === 0 ? <EmptyState title="今天还没有课程" description="可以从课表导入或新建一节真实课程。" action={<Link className="secondaryButton" href="/schedule-imports">导入课表</Link>} /> : <div className="todayWorkflowList">{data.todayLessons.map((lesson) => <article key={lesson.id}><time>{String(lesson.startTime || "待定")}<small>{String(lesson.endTime || "")}</small></time><div className="workflowLesson"><span className={`statusBadge ${String(lesson.status || "draft")}`}>{lesson.status === "completed" ? "已完成" : "待记录"}</span><h3>{String(lesson.topic || lesson.courseName || "未填写课题")}</h3><p>{String(lesson.className || "未关联班级")} · {String(lesson.location || (lesson.mode === "online" ? "线上" : "地点待补"))}</p><WorkflowChips lesson={lesson} /></div><Link className="primaryButton" href={`/lessons/${lesson.id}`}>{lesson.status === "completed" ? "查看记录" : "开始记录"}</Link></article>)}</div>}</section>

      <section className="panel"><div className="panelTitle"><div><p>未来安排</p><h2>未来七天</h2></div><Link href="/lessons">全部课时</Link></div>{data.upcomingLessons.length ? <div className="upcomingLessonList">{data.upcomingLessons.slice(0, 7).map((lesson) => <Link href={`/lessons/${lesson.id}`} key={lesson.id}><time>{String(lesson.date).slice(5)}<small>{String(lesson.startTime || "待定")}</small></time><div><b>{String(lesson.topic || lesson.courseName || "未填写课题")}</b><span>{String(lesson.className || "未关联班级")}</span></div></Link>)}</div> : <EmptyState title="未来七天暂无课程" description="后续课程会按日期自动出现在这里。" />}</section>

      <section className="panel"><div className="panelTitle"><div><p>教学闭环</p><h2>集中待办</h2></div></div><ul className="todoList"><li><Link href="/lessons">逾期待完成课时</Link><b>{data.overdueLessons.length}</b></li><li><Link href="/feedback">待确认反馈</Link><b>{data.pendingFeedback}</b></li><li><Link href="/assignments">待批改作业</Link><b>{data.pendingHomework}</b></li><li><Link href="/finance">待核对结算</Link><b>{data.pendingFinance}</b></li><li><Link href="/students">待跟进学生</Link><b>{data.riskCount}</b></li></ul></section>
    </div>

    <section className="questionWorkbenchCompact"><div><p>政治题库与组卷</p><h2>备课需要题目时，从这里继续</h2><span>原文优先、人工校对、教材目录检索；系统不会替您补写答案或知识点。</span></div><div className="questionWorkbenchActions"><Link href="/questions?import=1"><b>01</b><span>导入 Word</span><small>多 DOCX 队列</small></Link><Link href="/questions?status=review"><b>02</b><span>继续校对</span><small>{data.pendingReview} 道待处理</small></Link><Link href="/questions"><b>03</b><span>搜索题目</span><small>目录、关键词、标签</small></Link><Link href="/papers"><b>04</b><span>开始组卷</span><small>{paperCart} 道已加入草稿</small></Link></div></section>

    <div className="metricGrid"><article className="metricCard"><span>本周课时</span><b>{data.weekLessons}</b><small>真实教学安排</small></article><article className="metricCard"><span>出勤率</span><b>{data.attendanceRate == null ? "—" : `${data.attendanceRate}%`}</b><small>仅统计已记录出勤</small></article><article className="metricCard"><span>学生档案</span><b>{data.activeStudents}</b><small>{data.activeClasses} 个进行中班级</small></article><article className="metricCard"><span>组卷篮</span><b>{paperCart}</b><small>刷新后仍可继续组卷</small></article></div>
  </AppShell>;
}

export default function PublicHome() { return <ResourcesPage />; }
