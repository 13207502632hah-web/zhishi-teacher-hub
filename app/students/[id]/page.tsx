"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "../../components/AppShell";

type Data = { student: Record<string, unknown>; lessonRecords: any[]; submissions: any[]; feedback: any[]; results: any[] };

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>(), [data, setData] = useState<Data | null>(null), [contact, setContact] = useState("");
  useEffect(() => { fetch(`/api/students/${id}`).then((r) => r.json()).then(setData); }, [id]);
  const reveal = async () => { if (!confirm("监护人联系方式属于敏感信息。确认因教学沟通需要查看，并记录本次操作？")) return; const response = await fetch(`/api/students/${id}/private`), result = await response.json(); setContact(response.ok ? result.guardianContact : result.error || "当前角色无权查看"); };
  if (!data?.student) return <AppShell title="学生档案"><EmptyState title="正在读取档案" description="请稍候…" /></AppShell>;
  const student = data.student, total = data.lessonRecords.length + data.submissions.length + data.feedback.length + data.results.length;
  const items = [...data.lessonRecords.map((item) => ({ date: item.date, type: "课时表现", title: item.topic || item.courseName, detail: `参与 ${item.participation || "—"}/5 · 理解 ${item.understanding || "—"}/5 · 完成 ${item.completion || "—"}/5${item.teacherNote ? ` · ${item.teacherNote}` : ""}` })), ...data.submissions.map((item) => ({ date: item.lessonDate, type: "作业", title: item.title, detail: item.status === "completed" ? "已完成" : "待完成" })), ...data.feedback.map((item) => ({ date: item.lessonDate || item.created_at, type: "反馈", title: item.topic || "课程反馈", detail: item.status === "confirmed" ? "已确认" : "草稿" })), ...data.results.map((item) => ({ date: item.date, type: "测验", title: item.title, detail: item.score == null ? "待录入成绩" : `${item.score} 分` }))].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return <AppShell title={String(student.name)} subtitle={`${String(student.grade || "")} · 学习成长档案`}><div className="profileGrid"><section className="panel profileCard"><div className="profileHead"><span>{String(student.name).slice(0, 1)}</span><div><h2>{String(student.name)}</h2><p>{String(student.nickname || "未设置昵称")}</p></div>{Boolean(student.riskConfirmed) && <em className="riskBadge">教师确认关注 · {String(student.riskTags || "")}</em>}</div>
    <dl><div><dt>基础水平</dt><dd>{String(student.foundationLevel || "待记录")}</dd></div><div><dt>优势</dt><dd>{String(student.strengths || "待记录")}</dd></div><div><dt>薄弱知识点</dt><dd>{String(student.weakKnowledge || "待记录")}</dd></div><div><dt>学习习惯</dt><dd>{String(student.learningHabits || "待记录")}</dd></div><div><dt>阶段目标</dt><dd>{String(student.stageGoal || "待制定")}</dd></div></dl><div className="privacyNote">监护人联系方式属于敏感信息，普通档案视图不展示。{contact ? <b> {contact}</b> : <button onClick={reveal}>教师确认后查看</button>}</div></section>
    <section className="panel span2"><div className="panelTitle"><div><p>真实记录</p><h2>成长时间线</h2></div></div>{total === 0 ? <EmptyState title="还没有成长记录" description="完成课时表现、作业、测验或反馈后，会按时间显示在这里。" /> : <><div className="summaryCounts"><span>课时表现 <b>{data.lessonRecords.length}</b></span><span>作业记录 <b>{data.submissions.length}</b></span><span>课程反馈 <b>{data.feedback.length}</b></span><span>测验结果 <b>{data.results.length}</b></span></div><div className="growthTimeline">{items.map((item, index) => <article key={`${item.type}-${index}`}><time>{String(item.date || "日期待补")}</time><span>{item.type}</span><div><b>{String(item.title || "")}</b><p>{item.detail}</p></div></article>)}</div></>}</section></div></AppShell>;
}
