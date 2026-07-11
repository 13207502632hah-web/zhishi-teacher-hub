"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Row = Record<string, any> & { id: number; type: string; status: string };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const blank = () => ({ type: "lesson", lessonId: "", studentId: "", classId: "", tone: "专业简洁", learningContent: "", highlights: "", consolidate: "", homeworkRequirements: "", parentAdvice: "", nextFocus: "", periodStart: daysAgo(90), periodEnd: today(), periodSummary: "", progress: "", problems: "", goals: "", suggestions: "", content: "", status: "draft" });

function feedbackText(form: Record<string, any>) {
  const lesson = [
    `本节学习内容：${form.learningContent || "待补充"}`,
    `学生表现亮点：${form.highlights || "待补充"}`,
    `需要巩固：${form.consolidate || "待补充"}`,
    `作业要求：${form.homeworkRequirements || "待补充"}`,
    `沟通建议：${form.parentAdvice || "待补充"}`,
    `下节关注：${form.nextFocus || "待补充"}`,
  ];
  const stage = [
    `阶段总结：${form.periodSummary || "待补充"}`,
    `本阶段进步：${form.progress || "待补充"}`,
    `需要解决的问题：${form.problems || "待补充"}`,
    `下一阶段目标：${form.goals || "待补充"}`,
    `具体建议：${form.suggestions || "待补充"}`,
  ];
  const body = (form.type === "lesson" ? lesson : stage).join("\n\n");
  if (form.tone === "温和鼓励") return `您好，以下是本次学习反馈。\n\n${body}\n\n我们会继续关注每一步进展，也感谢您的配合。`;
  if (form.tone === "重点提醒") return `【重点学习提醒】\n\n${body}\n\n请优先落实上述巩固任务，并在下次课前完成检查。`;
  return body;
}

export default function FeedbackPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [lessons, setLessons] = useState<Row[]>([]);
  const [students, setStudents] = useState<Row[]>([]);
  const [classes, setClasses] = useState<Row[]>([]);
  const [form, setForm] = useState<any>(blank());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, l, s, c] = await Promise.all([
      fetch(`/api/feedback${filter ? `?type=${filter}` : ""}`).then((r) => r.json()),
      fetch("/api/lessons").then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
    ]);
    setRows(f.feedback || []); setLessons(l.lessons || []); setStudents(s.students || []); setClasses(c.classes || []);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search), lesson = params.get("lesson");
    if (lesson) fetch(`/api/lessons/${lesson}`).then((r) => r.json()).then((data) => {
      if (!data.lesson) return;
      setForm({ ...blank(), lessonId: lesson, classId: String(data.lesson.classId || ""), learningContent: data.lesson.actualContent || data.lesson.topic || "", homeworkRequirements: data.lesson.homework || "", nextFocus: data.lesson.nextPlan || "" });
      setOpen(true);
    });
    else if (params.get("new") === "1") setOpen(true);
  }, []);

  const save = async (status: string) => {
    setBusy(true); setMessage("");
    const payload = { ...form, content: feedbackText(form), status };
    const response = await fetch(editing ? `/api/feedback/${editing}` : "/api/feedback", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!response.ok) { setMessage("保存失败，请检查必填信息后重试"); return; }
    setOpen(false); setEditing(null); setForm(blank()); setMessage(status === "confirmed" ? "反馈已确认，可复制或打印" : "反馈草稿已保存"); load();
  };
  const applyTemplate = () => { if (form.type === "lesson") setForm({ ...form, learningContent: form.learningContent || "本节课围绕教材重点开展学习。", highlights: form.highlights || "能结合材料表达自己的理解。", consolidate: form.consolidate || "请结合错题继续巩固规范表述。", homeworkRequirements: form.homeworkRequirements || "按要求完成练习并整理疑问。", parentAdvice: form.parentAdvice || "可提醒孩子按时完成巩固任务。", nextFocus: form.nextFocus || "下节课继续进行材料分析与答题训练。" }); else setForm({ ...form, periodSummary: form.periodSummary || "本阶段已完成既定学习内容。", progress: form.progress || "能逐步运用教材观点分析材料。", problems: form.problems || "规范表述与知识点整合仍需巩固。", goals: form.goals || "提升材料分析的完整性与准确性。", suggestions: form.suggestions || "坚持错题复盘，并完成针对性练习。" }); setMessage("已填入可编辑模板，请按真实学习记录调整"); };
  const copyAsTemplate = (item: Row) => { setForm({ ...blank(), ...item, lessonId: "", studentId: "", classId: "", status: "draft", confirmedAt: null, sentAt: null }); setEditing(null); setOpen(true); setMessage("已复制为新草稿，请核对关联对象与具体内容"); };
  const markSent = async (id: number) => { if (!confirm("确认已通过您选择的渠道发送这条反馈？系统只记录状态，不会代发消息。")) return; const response = await fetch(`/api/feedback/${id}/sent`, { method: "POST" }), payload = await response.json(); setMessage(response.ok ? "已记录为发送完成" : payload.error || "标记发送失败"); if (response.ok) load(); };

  const buildSummary = async () => {
    if (!form.classId && !form.studentId) { setMessage("阶段汇总前，请先选择班级或学生"); return; }
    setBusy(true); setMessage("");
    const query = new URLSearchParams({ classId: form.classId, studentId: form.studentId, start: form.periodStart, end: form.periodEnd });
    const response = await fetch(`/api/feedback/summary?${query}`), data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "暂时无法汇总"); return; }
    setForm({ ...form, ...data.draft });
    setMessage("已按真实记录生成阶段草稿，请逐项核对并编辑后再确认");
  };

  const edit = (item: Row) => { setForm({ ...blank(), ...item, lessonId: String(item.lessonId || ""), studentId: String(item.studentId || ""), classId: String(item.classId || "") }); setEditing(item.id); setOpen(true); };
  const remove = async (id: number) => { if (!confirm("确认删除这条反馈？删除后不可恢复。")) return; await fetch(`/api/feedback/${id}`, { method: "DELETE" }); load(); };
  const copy = async (item: Row) => { await navigator.clipboard.writeText(item.content || feedbackText(item)); setMessage("反馈文本已复制，尚未发送给任何人"); };
  const print = async (id: number) => { if (!confirm("确认打印或导出这条反馈？")) return; await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "feedback", entityId: id }) }); window.print(); };

  return <AppShell title="课程反馈" subtitle="单节课与阶段反馈；生成后由教师逐项编辑确认" actions={<button className="primaryButton" onClick={() => { setEditing(null); setForm(blank()); setOpen(true); }}>＋ 新建反馈</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <div className="subnav" aria-label="反馈类型筛选"><button className={!filter ? "active" : ""} onClick={() => setFilter("")}>全部反馈</button><button className={filter === "lesson" ? "active" : ""} onClick={() => setFilter("lesson")}>单节课反馈</button><button className={filter === "stage" ? "active" : ""} onClick={() => setFilter("stage")}>阶段反馈</button></div>
    <section className="feedbackGrid">{rows.length === 0 ? <EmptyState title="还没有反馈" description="可从已完成课时生成草稿，或手动建立阶段反馈。系统不会自动向家长发送消息。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>建立第一条反馈</button>} /> : rows.map((item) => <article className="feedbackCard" key={item.id}>
      <div><span>{item.type === "lesson" ? "单节课" : "阶段"}</span><em className={`statusBadge ${item.status}`}>{item.status === "confirmed" ? "已确认" : "草稿"}</em></div>
      <h3>{item.studentId ? students.find((s) => s.id === item.studentId)?.name || "学生反馈" : item.classId ? classes.find((c) => c.id === item.classId)?.name || "班级反馈" : "通用反馈"}</h3>
      <pre>{String(item.content || feedbackText(item)).slice(0, 280)}</pre>
      <small>创建：{String(item.createdAt || "").slice(0, 16)}　修改：{String(item.updatedAt || "").slice(0, 16)}{item.sentAt ? "　已标记发送" : ""}</small>
      <div className="cardActions"><button onClick={() => edit(item)}>编辑</button><button onClick={() => copyAsTemplate(item)}>用作模板</button><button onClick={() => copy(item)}>复制文本</button>{item.status === "confirmed" && <button disabled={Boolean(item.sentAt)} onClick={() => markSent(item.id)}>{item.sentAt ? "已标记发送" : "标记已发送"}</button>}<button onClick={() => print(item.id)}>打印</button><button onClick={() => remove(item.id)}>删除</button></div>
    </article>)}</section>

    {open && <div className="modalBackdrop" role="presentation"><div className="lessonModal feedbackModal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="modalTitle"><div><p>{editing ? "编辑反馈" : "新建反馈"}</p><h2 id="feedback-title">{form.type === "lesson" ? "单节课反馈" : "阶段反馈"}</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="formGrid">
        <div className="wide summaryAction"><button type="button" className="secondaryButton" onClick={applyTemplate}>使用{form.type === "lesson" ? "单节课" : "阶段"}反馈模板</button><span>模板只填入可编辑的初稿，不替代真实课堂记录。</span></div>
        <label>反馈类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="lesson">单节课反馈</option><option value="stage">阶段反馈</option></select></label>
        <label>语气<select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}><option>专业简洁</option><option>温和鼓励</option><option>重点提醒</option></select></label>
        <label>关联课时<select value={form.lessonId} onChange={(e) => { const lesson = lessons.find((x) => x.id === Number(e.target.value)); setForm({ ...form, lessonId: e.target.value, classId: String(lesson?.classId || form.classId), learningContent: lesson?.actualContent || lesson?.topic || form.learningContent, homeworkRequirements: lesson?.homework || form.homeworkRequirements, nextFocus: lesson?.nextPlan || form.nextFocus }); }}><option value="">暂不关联</option>{lessons.map((x) => <option key={x.id} value={x.id}>{x.date} · {x.topic || x.courseName}</option>)}</select></label>
        <label>学生<select value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}><option value="">班级整体</option>{students.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>班级<select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">暂不关联</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {form.type === "lesson" ? <>
          <label className="wide">本节学习内容<textarea value={form.learningContent} onChange={(e) => setForm({ ...form, learningContent: e.target.value })} /></label>
          <label>学生表现亮点<textarea value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} /></label>
          <label>需要巩固的知识点<textarea value={form.consolidate} onChange={(e) => setForm({ ...form, consolidate: e.target.value })} /></label>
          <label>作业与完成要求<textarea value={form.homeworkRequirements} onChange={(e) => setForm({ ...form, homeworkRequirements: e.target.value })} /></label>
          <label>给家长的沟通建议<textarea value={form.parentAdvice} onChange={(e) => setForm({ ...form, parentAdvice: e.target.value })} /></label>
          <label className="wide">下节课关注点<textarea value={form.nextFocus} onChange={(e) => setForm({ ...form, nextFocus: e.target.value })} /></label>
        </> : <>
          <label>统计开始<input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></label>
          <label>统计结束<input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
          <div className="wide summaryAction"><button type="button" className="secondaryButton" disabled={busy} onClick={buildSummary}>{busy ? "正在汇总…" : "汇总真实课时、出勤、作业与测验"}</button><span>只生成草稿，不自动下结论</span></div>
          <label className="wide">阶段总结<textarea value={form.periodSummary} onChange={(e) => setForm({ ...form, periodSummary: e.target.value })} /></label>
          <label>本阶段进步<textarea value={form.progress} onChange={(e) => setForm({ ...form, progress: e.target.value })} /></label>
          <label>存在问题<textarea value={form.problems} onChange={(e) => setForm({ ...form, problems: e.target.value })} /></label>
          <label>下一阶段目标<textarea value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} /></label>
          <label>具体建议<textarea value={form.suggestions} onChange={(e) => setForm({ ...form, suggestions: e.target.value })} /></label>
        </>}
      </div>
      <div className="feedbackPreview"><b>反馈文本预览</b><pre>{feedbackText(form)}</pre></div>
      <div className="privacyNote">系统只生成可编辑草稿，不会自动发送短信、微信或家长群消息。</div>
      <div className="modalActions"><button disabled={busy} onClick={() => save("draft")}>保存草稿</button><button disabled={busy} className="primaryButton" onClick={() => save("confirmed")}>确认反馈</button></div>
    </div></div>}
  </AppShell>;
}
