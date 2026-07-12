"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, EmptyState } from "../../components/AppShell";

type Row = Record<string, any>;
type Data = { class: Row; members: Row[]; lessons: Row[]; assessments: Row[]; weakKnowledge: Row[]; attendanceRate: number | null; homeworkRate: number | null };

export default function ClassDetail() {
  const { id } = useParams<{ id: string }>(), [data, setData] = useState<Data | null>(null), [all, setAll] = useState<Row[]>([]), [pick, setPick] = useState("");
  const load = useCallback(() => Promise.all([fetch(`/api/classes/${id}`).then((r) => r.json()), fetch("/api/students").then((r) => r.json())]).then(([classData, studentData]) => { setData(classData); setAll(studentData.students || []); }), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!data?.class) return <AppShell title="班级详情"><EmptyState title="正在读取班级" description="请稍候…" /></AppShell>;
  const add = async () => { if (!pick) return; await fetch(`/api/classes/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: Number(pick) }) }); setPick(""); load(); };
  const remove = async (studentId: unknown) => { if (!confirm("确认将该学生移出班级？学生档案与历史记录不会删除。")) return; await fetch(`/api/classes/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId }) }); load(); };
  const value = data.class;
  return <AppShell title={String(value.name)} subtitle={`${String(value.stage)} · ${String(value.grade)} · ${String(value.courseType || "")}`} actions={<Link className="primaryButton" href={`/lessons?new=1&class=${id}`}>＋ 安排课时</Link>}>
    <div className="classOverview"><article><span>学生人数</span><b>{data.members.length}</b></article><article><span>近期课时</span><b>{data.lessons.length}</b></article><article><span>平均出勤</span><b>{data.attendanceRate == null ? "—" : `${data.attendanceRate}%`}</b><small>{data.attendanceRate == null ? "数据不足" : "按已记录出勤计算"}</small></article><article><span>作业完成</span><b>{data.homeworkRate == null ? "—" : `${data.homeworkRate}%`}</b><small>{data.homeworkRate == null ? "数据不足" : "按已提交作业计算"}</small></article></div>
    <div className="dashboardGrid"><section className="panel span2"><div className="panelTitle"><div><p>成员管理</p><h2>班级学生</h2></div><div className="inlineAdd"><select value={pick} onChange={(event) => setPick(event.target.value)}><option value="">选择已有学生</option>{all.filter((student) => !data.members.some((member) => member.id === student.id)).map((student) => <option key={String(student.id)} value={String(student.id)}>{String(student.name)} · {String(student.grade)}</option>)}</select><button onClick={add}>加入班级</button></div></div>
      {data.members.length === 0 ? <EmptyState title="班级还没有学生" description="可从已有学生档案中选择加入，或先录入新学生。" action={<Link href="/students?new=1" className="secondaryButton">录入学生</Link>} /> : <div className="memberList">{data.members.map((student) => <article key={String(student.id)}><Link href={`/students/${student.id}`}><b>{String(student.name)}</b><span>{String(student.grade)} · {String(student.weakKnowledge || "暂无薄弱知识点记录")}</span></Link>{Boolean(student.riskConfirmed) && <em className="riskBadge">{String(student.riskTags)}</em>}<button onClick={() => remove(student.id)}>移出</button></article>)}</div>}
    </section><section className="panel"><div className="panelTitle"><div><p>课程时间线</p><h2>近期课时</h2></div></div>{data.lessons.length === 0 ? <EmptyState title="还没有课时" description="安排第一节课后，这里会显示课程时间线。" /> : <div className="miniTimeline">{data.lessons.slice(0, 6).map((lesson) => <Link href={`/lessons/${lesson.id}`} key={String(lesson.id)}><time>{String(lesson.date)}</time><b>{String(lesson.topic || lesson.courseName)}</b></Link>)}</div>}</section></div>
    <div className="dashboardGrid"><section className="panel span2"><div className="panelTitle"><div><p>真实测验数据</p><h2>近期成绩变化</h2></div><Link href={`/assessments?classId=${id}`}>管理测验</Link></div>{data.assessments?.length ? <div className="miniTimeline">{data.assessments.map((item) => <Link href={`/assessments/${item.id}`} key={String(item.id)}><time>{String(item.date)}</time><b>{String(item.title)} · 平均 {item.averageScore ?? "—"}/{String(item.totalScore)}</b></Link>)}</div> : <EmptyState title="还没有测验" description="新建测验并录入成绩后显示班级变化。" action={<Link className="secondaryButton" href="/assessments">新建测验</Link>} />}</section><section className="panel"><div className="panelTitle"><div><p>教师录入汇总</p><h2>共性薄弱知识点</h2></div></div>{data.weakKnowledge?.length ? <div className="analyticsList">{data.weakKnowledge.map((item) => <p key={String(item.name)}><span>{String(item.name)}</span><em>{String(item.count)} 人</em></p>)}</div> : <EmptyState title="数据不足" description="在成绩录入时填写薄弱知识点后自动汇总。" />}</section></div>
  </AppShell>;
}
