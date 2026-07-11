"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Row = Record<string, any> & { id: number };
const blank = () => ({ lessonId: "", date: new Date().toISOString().slice(0, 10), tags: "", problemType: "", expectedVsActual: "", effectivePractices: "", difficulties: "", studentEvidence: "", nextAction: "", actionCompleted: false, reusableMaterial: "", isStrategy: false });
const problemTypes = ["课堂节奏", "知识理解", "材料分析", "规范表达", "课堂参与", "作业落实", "价值引领", "其他"];

export default function ReflectionsPage() {
  const [rows, setRows] = useState<Row[]>([]), [lessons, setLessons] = useState<Row[]>([]), [classes, setClasses] = useState<Row[]>([]);
  const [q, setQ] = useState(""), [tag, setTag] = useState(""), [month, setMonth] = useState(""), [topic, setTopic] = useState(""), [problemType, setProblemType] = useState(""), [classId, setClassId] = useState("");
  const [form, setForm] = useState<any>(blank()), [open, setOpen] = useState(false), [editing, setEditing] = useState<number | null>(null), [message, setMessage] = useState(""), [view, setView] = useState<"list" | "calendar">("list");

  const load = useCallback(async () => {
    const query = new URLSearchParams({ q, tag, month, topic, problemType, classId });
    const result = await fetch(`/api/reflections?${query}`).then((r) => r.json()); setRows(result.reflections || []);
  }, [q, tag, month, topic, problemType, classId]);
  useEffect(() => {
    Promise.all([fetch("/api/lessons").then((r) => r.json()), fetch("/api/classes").then((r) => r.json())]).then(([l, c]) => { setLessons(l.lessons || []); setClasses(c.classes || []); });
    void load();
    const params = new URLSearchParams(location.search);
    if (params.get("lesson")) { setForm({ ...blank(), lessonId: params.get("lesson") }); setOpen(true); }
    else if (params.get("new") === "1") setOpen(true);
  }, [load]);

  const save = async () => {
    const response = await fetch(editing ? `/api/reflections/${editing}` : "/api/reflections", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!response.ok) { setMessage("保存失败，请检查日期和内容"); return; }
    setOpen(false); setEditing(null); setForm(blank()); setMessage("反思已私密保存"); load();
  };
  const edit = (item: Row) => { setForm({ ...blank(), ...item, lessonId: String(item.lessonId || "") }); setEditing(item.id); setOpen(true); };
  const remove = async (id: number) => { if (!confirm("确认删除这条私密反思？删除后不可恢复。")) return; await fetch(`/api/reflections/${id}`, { method: "DELETE" }); load(); };
  const promote = async (id: number) => { if (!confirm("确认将有效做法、改进动作和可复用素材沉淀为“教学策略”资源？")) return; await fetch(`/api/reflections/${id}`, { method: "POST" }); setMessage("完整内容已沉淀为教学策略"); load(); };
  const calendarMonth = month || new Date().toISOString().slice(0, 7);
  const calendar = useMemo(() => {
    const [year, m] = calendarMonth.split("-").map(Number), first = new Date(year, m - 1, 1), count = new Date(year, m, 0).getDate();
    return { offset: (first.getDay() + 6) % 7, days: Array.from({ length: count }, (_, i) => `${calendarMonth}-${String(i + 1).padStart(2, "0")}`) };
  }, [calendarMonth]);

  return <AppShell title="教学反思" subtitle="默认私密的教学复盘与策略沉淀" actions={<button className="primaryButton" onClick={() => { setEditing(null); setForm(blank()); setOpen(true); }}>＋ 新建反思</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <div className="reflectionToolbar">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="全文搜索做法、困难或改进动作" aria-label="全文搜索" />
      <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="主题标签" aria-label="主题标签" />
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="课题" aria-label="课题" />
      <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="班级"><option value="">全部班级</option>{classes.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
      <select value={problemType} onChange={(e) => setProblemType(e.target.value)} aria-label="问题类型"><option value="">全部问题类型</option>{problemTypes.map((x) => <option key={x}>{x}</option>)}</select>
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="月份" />
      <button onClick={load}>筛选</button>
    </div>
    <div className="viewSwitch" aria-label="视图切换"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>列表</button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>日历</button></div>

    {view === "calendar" ? <section className="reflectionCalendar"><header><h2>{calendarMonth} 教学反思日历</h2><p>完整内容仍为私密，仅显示摘要。</p></header><div className="calendarWeek"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="calendarGrid">{Array.from({ length: calendar.offset }, (_, i) => <i key={`blank-${i}`} />)}{calendar.days.map((date) => { const items = rows.filter((r) => r.date === date); return <article key={date}><b>{Number(date.slice(-2))}</b>{items.slice(0, 2).map((r) => <button key={r.id} onClick={() => edit(r)}>{r.lessonTopic || r.problemType || "教学反思"}</button>)}{items.length > 2 && <small>另 {items.length - 2} 条</small>}</article>; })}</div></section> : <section className="reflectionList">{rows.length === 0 ? <EmptyState title="还没有教学反思" description="完成一节课后，记录预设与实际差异、有效做法和下次可执行动作。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>记录第一条反思</button>} /> : rows.map((item) => <article className="reflectionCard" key={item.id}>
      <header><time>{item.date}</time><span>私密</span>{item.problemType && <em>{item.problemType}</em>}{item.isStrategy && <em>已沉淀为策略</em>}{item.actionCompleted && <em>改进动作已完成</em>}</header>
      <h3>{item.lessonTopic || item.courseName || "独立教学反思"}</h3><small>{item.className || "未关联班级"} · {item.tags || "未设置标签"}</small>
      <div className="reflectionColumns"><p><b>有效做法</b>{item.effectivePractices || "待补充"}</p><p><b>困难与原因</b>{item.difficulties || "待补充"}</p><p><b>下次改进动作</b>{item.nextAction || "待补充"}</p></div>
      <div className="cardActions"><button onClick={() => edit(item)}>编辑</button><button disabled={item.isStrategy} onClick={() => promote(item.id)}>{item.isStrategy ? "已沉淀" : "沉淀为策略"}</button><button onClick={() => remove(item.id)}>删除</button></div>
    </article>)}</section>}

    {open && <div className="modalBackdrop"><div className="lessonModal" role="dialog" aria-modal="true" aria-labelledby="reflection-title"><div className="modalTitle"><div><p>完整内容默认私密</p><h2 id="reflection-title">{editing ? "编辑教学反思" : "新建教学反思"}</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="formGrid">
        <label>日期<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        <label>关联课时<select value={form.lessonId} onChange={(e) => setForm({ ...form, lessonId: e.target.value })}><option value="">独立反思</option>{lessons.map((l) => <option value={l.id} key={l.id}>{l.date} · {l.topic || l.courseName}</option>)}</select></label>
        <label>问题类型<select value={form.problemType} onChange={(e) => setForm({ ...form, problemType: e.target.value })}><option value="">暂不归类</option>{problemTypes.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>主题标签<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="如：材料分析、课堂节奏" /></label>
        <label className="wide">预设与实际差异<textarea value={form.expectedVsActual} onChange={(e) => setForm({ ...form, expectedVsActual: e.target.value })} /></label>
        <label>有效做法<textarea value={form.effectivePractices} onChange={(e) => setForm({ ...form, effectivePractices: e.target.value })} /></label>
        <label>困难与原因<textarea value={form.difficulties} onChange={(e) => setForm({ ...form, difficulties: e.target.value })} /></label>
        <label>学生反馈证据<textarea value={form.studentEvidence} onChange={(e) => setForm({ ...form, studentEvidence: e.target.value })} /></label>
        <label>下一次可执行改进动作<textarea value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} /></label>
        <label className="wide">可复用素材 / 话术 / 活动设计<textarea value={form.reusableMaterial} onChange={(e) => setForm({ ...form, reusableMaterial: e.target.value })} /></label>
        <label className="checkLabel"><input type="checkbox" checked={Boolean(form.actionCompleted)} onChange={(e) => setForm({ ...form, actionCompleted: e.target.checked })} />改进动作已完成</label>
        <label className="checkLabel"><input type="checkbox" checked={Boolean(form.isStrategy)} onChange={(e) => setForm({ ...form, isStrategy: e.target.checked })} />标记为可复用教学策略</label>
      </div>
      <div className="modalActions"><button onClick={() => setOpen(false)}>取消</button><button className="primaryButton" onClick={save}>私密保存</button></div>
    </div></div>}
  </AppShell>;
}
