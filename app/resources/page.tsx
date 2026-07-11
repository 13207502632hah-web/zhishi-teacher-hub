"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Resource = Record<string, any> & { id: number };
const blank = { title: "", type: "备课素材", tags: "", url: "", content: "", visibility: "private" };

export default function ResourcesPage() {
  const [rows, setRows] = useState<Resource[]>([]), [q, setQ] = useState(""), [open, setOpen] = useState(false), [form, setForm] = useState(blank), [message, setMessage] = useState("");
  const load = () => fetch(`/api/resources?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((data) => setRows(data.resources || []));
  useEffect(() => { load(); }, []);
  const save = async () => { const response = await fetch("/api/resources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }); if (!response.ok) { setMessage("请填写资源名称"); return; } setOpen(false); setForm(blank); setMessage("资源已保存"); load(); };
  const remove = async (id: number) => { if (!confirm("确认删除这份资源？删除后不可恢复。")) return; await fetch(`/api/resources/${id}`, { method: "DELETE" }); load(); };

  return <AppShell title="资源中心" subtitle="让教学准备更从容一点：保存素材，也承接反思中沉淀的教学策略" actions={<button className="primaryButton" onClick={() => setOpen(true)}>＋ 添加资源</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <section className="resourceWelcome"><div><p>知师研室 · 备课灵感库</p><h2>让一份好资源，真正回到课堂。</h2><span>这里保留原有资源展示入口，并连接题库、课时与教学反思。</span></div><div className="resourceShortcuts"><Link href="/questions?import=1"><b>题库导入</b><span>Word 上传、识别预览、逐题校对</span></Link><Link href="/papers"><b>轻量组卷</b><span>按知识点、题型、难度组合</span></Link><Link href="/reflections"><b>教学策略</b><span>从真实教学反思沉淀</span></Link></div></section>
      <div className="toolbar"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="搜索资源名称、标签或内容" aria-label="搜索资源" /><button onClick={load}>搜索</button></div>
      <section className="resourceGrid">{rows.length === 0 ? <EmptyState title="还没有个人资源" description="可以手动添加备课素材，也可以在教学反思中将有效做法沉淀为教学策略。这里不会填充虚构资源。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>添加第一份资源</button>} /> : rows.map((item) => <article className="resourceCard" key={item.id}><div><span>{item.type || "资源"}</span>{item.sourceRef?.startsWith("reflection:") && <em>来自教学反思</em>}</div><h3>{item.title}</h3><p>{item.content || "暂无内容说明"}</p><small>{item.tags || "未设置标签"}</small><div className="cardActions">{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开链接</a>}<button onClick={async () => { if (!confirm("确认打印或导出这份资源？")) return; await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "resource", entityId: item.id }) }); window.print(); }}>打印</button><button onClick={() => remove(item.id)}>删除</button></div></article>)}</section>
    {open && <div className="modalBackdrop"><div className="lessonModal small" role="dialog" aria-modal="true" aria-labelledby="resource-title"><div className="modalTitle"><div><p>保存个人教学资产</p><h2 id="resource-title">添加资源</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div><div className="formGrid"><label className="wide">资源名称<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>备课素材</option><option>课堂活动</option><option>教学策略</option><option>规范话术</option><option>其他</option></select></label><label>可见范围<select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}><option value="private">仅教师与助教</option><option value="public">公开给学生、家长和访客</option></select></label><label className="wide">标签<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="逗号分隔" /></label><label className="wide">外部链接（可选）<input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label><label className="wide">内容说明<textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></label></div><div className="privacyNote">公开资源会被匿名访客看到；包含学生信息的内容必须保持“仅教师与助教”。</div><div className="modalActions"><button onClick={() => setOpen(false)}>取消</button><button className="primaryButton" onClick={save}>保存资源</button></div></div></div>}
  </AppShell>;
}
