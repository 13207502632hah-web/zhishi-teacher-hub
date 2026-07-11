"use client";

import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

export default function PortalPage() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetch("/api/portal").then((r) => r.json()).then(setData); }, []);
  if (!data) return <AppShell title="我的学习"><EmptyState title="正在读取已授权内容" description="请稍候…" /></AppShell>;
  if (!data.students?.length) return <AppShell title="我的学习"><EmptyState title="账号尚未关联学生档案" description="请教师在设置中将该账号关联到对应学生；关联前不会展示任何学生数据。" /></AppShell>;
  return <AppShell title="我的学习" subtitle={data.role === "parent" ? "仅查看孩子的已确认反馈、作业与指定资料" : "仅查看自己的作业、反馈与指定资料"}>
    <div className="portalStudents">{data.students.map((student: any) => <article key={student.id}><b>{student.name}</b><span>{student.grade || ""}</span><p>阶段目标：{student.stageGoal || "教师尚未填写"}</p></article>)}</div>
    <div className="dashboardGrid"><section className="panel"><div className="panelTitle"><div><p>学习任务</p><h2>作业</h2></div></div>{data.assignments.length === 0 ? <EmptyState title="暂无作业" description="教师布置并关联后会显示在这里。" /> : <div className="portalList">{data.assignments.map((item: any) => <article key={item.id}><b>{item.title}</b><span>{item.status === "completed" ? "已完成" : "待完成"} · {item.dueAt || "未设置截止时间"}</span><p>{item.requirements || "无补充要求"}</p></article>)}</div>}</section>
      <section className="panel"><div className="panelTitle"><div><p>教师确认</p><h2>课程反馈</h2></div></div>{data.feedback.length === 0 ? <EmptyState title="暂无已确认反馈" description="草稿不会显示；教师确认后才会出现在这里。" /> : <div className="portalList">{data.feedback.map((item: any) => <article key={item.id}><b>{item.type === "stage" ? "阶段反馈" : "单节课反馈"}</b><pre>{item.content}</pre></article>)}</div>}</section>
      <section className="panel"><div className="panelTitle"><div><p>教师指定</p><h2>学习资料</h2></div></div>{data.resources.length === 0 ? <EmptyState title="暂无指定资料" description="教师公开资料后会显示在这里。" /> : <div className="portalList">{data.resources.map((item: any) => <article key={item.id}><b>{item.title}</b><p>{item.content || item.tags || ""}</p>{item.url && <a href={item.url}>打开资料</a>}</article>)}</div>}</section></div>
  </AppShell>;
}
