"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

export default function MiniSettingsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [bindings, setBindings] = useState<any[]>([]);
  const [studentId, setStudentId] = useState("");
  const [role, setRole] = useState("parent");
  const [invite, setInvite] = useState<any>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [studentData, bindingData] = await Promise.all([
      fetch("/api/students").then((response) => response.json()),
      fetch("/api/v2/mini/invites").then((response) => response.json()),
    ]);
    setStudents(studentData.students || []);
    setBindings(bindingData.bindings || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const response = await fetch("/api/v2/mini/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: Number(studentId), role }),
    });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error || "生成失败"); return; }
    setInvite(data);
    setMessage("邀请码已生成；输入后仍需教师在本页确认");
  };

  const decide = async (id: number, decision: string) => {
    const label = decision === "confirm" ? "确认" : decision === "reject" ? "拒绝" : "停用";
    if (!confirm(`${label}这条绑定关系？停用后旧会话将立即失去该学生的数据权限。`)) return;
    const response = await fetch(`/api/v2/mini/bindings/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await response.json();
    setMessage(response.ok ? `已${label}绑定` : data.error || `${label}失败`);
    if (response.ok) void load();
  };

  return <AppShell title="微信小程序" subtitle="学生与家长账号绑定、确认与停用">
    <section className="securityBanner">
      <div><b>一期仅服务学生与家长</b><span>教师使用网站或 iOS 端</span></div>
      <p>小程序只显示教师已经确认并发布的内容；发布作业、批改、审批和正式反馈均不能在小程序执行。</p>
    </section>
    {message && <div className="saveToast">{message}</div>}
    <section className="panel">
      <div className="panelTitle"><div><p>第一步</p><h2>生成7天有效的一次性邀请码</h2></div></div>
      <div className="formGrid">
        <label>学生<select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">请选择</option>{students.map((student) => <option value={student.id} key={student.id}>{student.name} · {student.grade}</option>)}</select></label>
        <label>身份<select value={role} onChange={(event) => setRole(event.target.value)}><option value="parent">家长</option><option value="student">学生</option></select></label>
      </div>
      <button className="primaryButton" disabled={!studentId} onClick={create}>生成邀请码</button>
      {invite && <div className="metricCard"><span>{role === "parent" ? "家长" : "学生"}邀请码</span><b>{invite.code}</b><small>有效期至 {String(invite.expiresAt).slice(0, 16)}；使用后进入待确认，不会立即开放学生数据。</small></div>}
    </section>
    <section className="panel">
      <div className="panelTitle"><div><p>第二步</p><h2>教师确认学生或家长绑定</h2></div></div>
      {bindings.length === 0 ? <EmptyState title="暂无绑定申请" description="学生或家长输入邀请码后，申请会出现在这里。" /> : <div className="accountList">{bindings.map((item) => <article key={item.id}><div><b>{item.displayName || "微信用户"} → {item.studentName}</b><span>{item.role === "parent" ? "家长" : "学生"} · {item.status === "pending" ? "待确认" : item.status === "active" ? "已生效" : item.status === "disabled" ? "已停用" : "已拒绝"}</span></div><em>{String(item.createdAt || "").slice(0, 16)}</em>{item.status === "pending" && <><button onClick={() => void decide(item.id, "confirm")}>确认</button><button onClick={() => void decide(item.id, "reject")}>拒绝</button></>}{item.status === "active" && <button onClick={() => void decide(item.id, "disable")}>停用</button>}</article>)}</div>}
    </section>
    <section className="panel"><h2>一期明确范围</h2><p>作业查看、多附件提交、家长代交、订正版本、确认后的批改结果、错题讲解、学习进度和多孩子切换。不开发学生自由聊天、点赞、评论、排行、收费商城或教师端发布工具。</p></section>
  </AppShell>;
}
