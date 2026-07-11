"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Data = Record<string, any>;

const metric = (label: string, value: any, definition: string) => <article className="analyticsMetric"><span>{label}</span><b>{value == null ? "—" : value}</b><details><summary>口径说明</summary><p>{definition}</p></details></article>;

export default function AnalyticsPage() {
  const [range, setRange] = useState("week"), [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    setData(null);
    try {
      const response = await fetch(`/api/analytics?range=${range}`), payload = await response.json();
      if (!response.ok || !payload?.teaching || !payload?.classroom || !payload?.questionBank || !payload?.growth) throw new Error(payload?.error || "暂时无法读取统计数据");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "暂时无法读取统计数据"); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <AppShell title="数据中心"><EmptyState title="暂时无法读取统计数据" description={`${error}。请稍后刷新重试。`} action={<button className="secondaryButton" onClick={load}>重新读取</button>} /></AppShell>;
  if (!data) return <AppShell title="数据中心"><EmptyState title="正在计算真实数据" description="请稍候…" /></AppShell>;
  const insufficient = data.teaching.lessons === 0 && data.questionBank.total === 0 && data.growth.reflections === 0;
  const max = Math.max(1, ...data.questionBank.difficulty.map((item: any) => Number(item.count)));
  return <AppShell title="数据中心" subtitle="所有指标均来自已录入记录，不生成推测性结论">
    <div className="rangeTabs"><button className={range === "week" ? "active" : ""} onClick={() => setRange("week")}>周</button><button className={range === "month" ? "active" : ""} onClick={() => setRange("month")}>月</button><button className={range === "term" ? "active" : ""} onClick={() => setRange("term")}>学期</button><span>统计起始：{data.start}</span></div>
    {insufficient && <div className="noticeStrip"><b>数据不足，继续记录后可查看趋势</b><span>完成课时、学生表现、题目和反思记录后，图表会自动更新。</span></div>}
    <section className="analyticsSection"><div className="panelTitle"><div><p>教学</p><h2>教学记录质量</h2></div></div><div className="analyticsGrid">{metric("课时数", data.teaching.lessons, "所选时间范围内创建的全部课时。")}{metric("备课完成率", data.teaching.prepRate == null ? null : `${data.teaching.prepRate}%`, "同时填写教学目标和重点的课时数 ÷ 全部课时数。")}{metric("课时记录完成率", data.teaching.completedRate == null ? null : `${data.teaching.completedRate}%`, "状态为“已完成”的课时数 ÷ 全部课时数。")}{metric("反馈及时率", data.teaching.feedbackRate == null ? null : `${data.teaching.feedbackRate}%`, "关联课时且在课后 48 小时内确认的反馈数 ÷ 所选范围内反馈总数。")}</div></section>
    <section className="analyticsColumns"><div className="analyticsSection"><div className="panelTitle"><div><p>班级与学生</p><h2>学习记录</h2></div></div><div className="analyticsGrid two">{metric("出勤率", data.classroom.attendanceRate == null ? null : `${data.classroom.attendanceRate}%`, "标记为出勤的记录数 ÷ 全部出勤记录。")}{metric("作业完成率", data.classroom.homeworkRate == null ? null : `${data.classroom.homeworkRate}%`, "状态为已完成的提交数 ÷ 全部作业提交记录。")}{metric("测验平均分", data.classroom.assessmentAverage, "所选范围内已有成绩的测验结果算术平均值。")}{metric("测验记录", data.classroom.assessmentCount, "所选范围内已录入成绩的测验结果数量。")}</div>{data.studentTrend.length < 2 ? <p className="dataEmpty">数据不足，至少记录两个日期的学生表现后可查看趋势。</p> : <div className="trendBars">{data.studentTrend.map((item: any) => <div key={item.date}><span>{item.date.slice(5)}</span><i style={{ height: `${Number(item.participation || 0) * 18}px` }}></i><em style={{ height: `${Number(item.understanding || 0) * 18}px` }}></em></div>)}</div>}</div>
      <div className="analyticsSection"><div className="panelTitle"><div><p>题库</p><h2>覆盖与难度</h2></div></div><div className="analyticsGrid two">{metric("正式题目", data.questionBank.total, "状态为“正式题库”的题目数量。")}{metric("知识点覆盖率", data.questionBank.coverageRate == null ? null : `${data.questionBank.coverageRate}%`, "已标注知识点的正式题目数 ÷ 正式题目总数。")}</div>{data.questionBank.difficulty.length === 0 ? <p className="dataEmpty">数据不足，添加正式题目后可查看难度分布。</p> : <div className="difficultyChart">{[1, 2, 3, 4, 5].map((level) => { const item = data.questionBank.difficulty.find((row: any) => Number(row.difficulty) === level), count = Number(item?.count || 0); return <div key={level}><b style={{ height: `${count / max * 110}px` }}></b><span>{level}级</span><em>{count}</em></div>; })}</div>}{data.questionBank.frequent?.length > 0 && <div className="analyticsList"><b>常用题目</b>{data.questionBank.frequent.map((item: any) => <p key={item.id}><span>{item.stem}</span><em>使用 {item.useCount} 次</em></p>)}</div>}</div></section>
    <section className="analyticsSection"><div className="panelTitle"><div><p>趋势补充</p><h2>作业与知识点记录</h2></div></div><div className="analyticsColumns"><div>{data.homeworkTrend?.length < 2 ? <p className="dataEmpty">数据不足，至少记录两个日期的作业提交后可查看作业趋势。</p> : <div className="analyticsList"><b>按课时日期的作业完成</b>{data.homeworkTrend.map((item: any) => <p key={item.date}><span>{item.date}</span><em>{item.completed}/{item.total} 已完成</em></p>)}</div>}</div><div>{data.classroom.knowledgeMastery?.length === 0 ? <p className="dataEmpty">数据不足，录入测验知识点掌握记录后可查看。</p> : <div className="analyticsList"><b>测验中的知识点掌握记录</b>{data.classroom.knowledgeMastery.map((item: any) => <p key={item.mastery}><span>{item.mastery}</span><em>{item.count} 条</em></p>)}</div>}</div></div></section>
    <section className="analyticsSection"><div className="panelTitle"><div><p>自我成长</p><h2>反思与改进</h2></div></div><div className="analyticsGrid">{metric("反思数量", data.growth.reflections, "所选范围内的私密教学反思数量。")}{metric("改进动作完成率", data.growth.actionRate == null ? null : `${data.growth.actionRate}%`, "标记为已完成的改进动作 ÷ 全部反思。")}{metric("沉淀教学策略", data.growth.strategies, "已标记为可复用教学策略的反思数量。")}{metric("重复问题", data.growth.repeatedProblems.length, "完全相同且重复出现两次以上的困难记录。")}</div>{data.growth.repeatedProblems.length > 0 && <div className="analyticsList"><b>重复出现的问题</b>{data.growth.repeatedProblems.map((item: any) => <p key={item.difficulties}><span>{item.difficulties}</span><em>{item.count} 次</em></p>)}</div>}</section>
  </AppShell>;
}
