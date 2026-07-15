"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "./components/AppShell";
import ResourcesPage from "./resources/page";

type D = { weekLessons: number; draftLessons: number; confirmedFeedback: number; pendingFeedback: number; attendanceRate: number | null; homeworkRate: number | null; pendingHomework: number; riskCount: number; pendingReview: number; reviewIssues: { missingAnswer: number; missingAnalysis: number; missingClassification: number; lowConfidence: number }; activeClasses: number; activeStudents: number; todayLessons: Array<Record<string, unknown>>; riskStudents: Array<Record<string, unknown>>; recentReflections: Array<Record<string, unknown>>; recentQuestions: Array<Record<string, unknown>> };
const empty: D = { weekLessons: 0, draftLessons: 0, confirmedFeedback: 0, pendingFeedback: 0, attendanceRate: null, homeworkRate: null, pendingHomework: 0, riskCount: 0, pendingReview: 0, reviewIssues: { missingAnswer: 0, missingAnalysis: 0, missingClassification: 0, lowConfidence: 0 }, activeClasses: 0, activeStudents: 0, todayLessons: [], riskStudents: [], recentReflections: [], recentQuestions: [] };

export function Dashboard() {
  const [data, setData] = useState<D>(empty), [loading, setLoading] = useState(true), [paperCart, setPaperCart] = useState(0);
  useEffect(() => { try { setPaperCart((JSON.parse(localStorage.getItem("zhishi:paper-cart") || "[]") as number[]).length); } catch { setPaperCart(0); } fetch("/api/dashboard").then((response) => response.ok ? response.json() : empty).then(setData).catch(() => setData(empty)).finally(() => setLoading(false)); }, []);
  const metrics = [["待校对题目", data.pendingReview, "Word 导入后需人工确认"], ["缺少答案", data.reviewIssues.missingAnswer, "不自动补写答案"], ["分类待完善", data.reviewIssues.missingClassification, "按教材目录逐级归档"], ["组卷篮", paperCart, "刷新后仍可继续组卷"]] as const;
  return <AppShell title="政治题库工作台" subtitle="导入、校对、检索、组卷集中在一个入口" actions={<Link href="/questions?import=1" className="primaryButton">＋ 导入 Word</Link>}>
    {loading && <div className="noticeStrip"><b>正在读取本地题库状态…</b></div>}
    <section className="questionWorkbenchHero"><div><p>莫老师的个人政治题库</p><h2>从一份 Word，到一张可复用的试卷</h2><span>原文优先、人工校对、教材目录检索；系统不会替您补写答案或知识点。</span></div><div className="questionWorkbenchActions"><Link href="/questions?import=1"><b>01</b><span>导入 Word</span><small>支持多 DOCX 队列</small></Link><Link href="/questions?status=review"><b>02</b><span>继续校对</span><small>{data.pendingReview} 道待处理</small></Link><Link href="/questions"><b>03</b><span>搜索题目</span><small>目录、关键词、标签</small></Link><Link href="/papers"><b>04</b><span>开始组卷</span><small>{paperCart} 道已加入草稿</small></Link></div></section>
    <div className="metricGrid">{metrics.map(([label, value, note]) => <article className="metricCard" key={label}><span>{label}</span><b>{value}</b><small>{note}</small></article>)}</div>
    <div className="dashboardGrid">
      <section className="panel span2"><div className="panelTitle"><div><p>题库整理</p><h2>待校对进度</h2></div><Link href="/questions?status=review">进入批量校对</Link></div><div className="reviewProgress"><b>{data.pendingReview}</b><span>道题待处理</span></div><div className="cardActions"><Link href="/questions?status=review&issue=missing_answer">缺答案 {data.reviewIssues.missingAnswer}</Link><Link href="/questions?status=review&issue=missing_analysis">缺解析 {data.reviewIssues.missingAnalysis}</Link><Link href="/questions?status=review&issue=classification">分类不完整 {data.reviewIssues.missingClassification}</Link><Link href="/questions?status=review&issue=low_confidence">低置信度 {data.reviewIssues.lowConfidence}</Link></div></section>
      <section className="panel"><div className="panelTitle"><div><p>回到教学</p><h2>其他待办</h2></div></div><ul className="todoList"><li><Link href="/lessons">待处理课时</Link><b>{data.draftLessons}</b></li><li><Link href="/feedback">待确认反馈</Link><b>{data.pendingFeedback}</b></li><li><Link href="/assignments">待批改作业</Link><b>{data.pendingHomework}</b></li><li><Link href="/students">待跟进学生</Link><b>{data.riskCount}</b></li></ul></section>
      <section className="panel span2"><div className="panelTitle"><div><p>最近更新</p><h2>题库动态</h2></div><Link href="/questions">打开正式题库</Link></div>{data.recentQuestions.length === 0 ? <EmptyState title="还没有题库动态" description="导入 Word 或手动录题后，这里会显示最近更新。" /> : <div className="activityFeed">{data.recentQuestions.map((item) => <Link href="/questions" key={`q-${item.id}`}><span>题库</span><b>{item.status === "active" ? "正式题目" : "待校对题目"}</b><p>{String(item.stem || "")}</p></Link>)}</div>}</section>
      <section className="panel"><div className="panelTitle"><div><p>本周教学</p><h2>概览</h2></div><Link href="/lessons">查看课时</Link></div><ul className="todoList"><li><span>本周课时</span><b>{data.weekLessons}</b></li><li><span>进行中班级</span><b>{data.activeClasses}</b></li><li><span>学生档案</span><b>{data.activeStudents}</b></li><li><span>出勤率</span><b>{data.attendanceRate == null ? "—" : `${data.attendanceRate}%`}</b></li></ul></section>
      <section className="panel span2"><div className="panelTitle"><div><p>教学安排</p><h2>今日课程</h2></div><Link href="/lessons">查看全部</Link></div>{data.todayLessons.length === 0 ? <EmptyState title="今天还没有课程" description="新建今天的课时后，会在这里显示时间、课题和班级。" /> : <div className="todayList">{data.todayLessons.map((item) => <article key={String(item.id)}><time>{String(item.startTime || "待定")}</time><div><b>{String(item.topic || item.courseName || "未填写课题")}</b><span>{String(item.className || "未关联班级")}</span></div><span className={`statusBadge ${String(item.status || "draft")}`}>{item.status === "completed" ? "已完成" : "备课中"}</span><Link href={`/lessons/${item.id}`}>开始记录</Link></article>)}</div>}</section>
    </div>
  </AppShell>;
}

export default function PublicHome() { return <ResourcesPage />; }
