"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell, EmptyState } from "../components/AppShell";
import { generateFeedback } from "../lib/feedback-generator";

type Row = Record<string, any> & { id: number; type: string; status: string };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const blank = () => ({ type: "lesson", audience: "private", lengthMode: "short", lessonId: "", studentId: "", classId: "", tone: "温和鼓励", opening: "", closing: "", styleRules: "", previousHomework: "", classPerformance: "", weakPoints: "", dueAt: "", customInput: "", learningContent: "", highlights: "", consolidate: "", homeworkRequirements: "", parentAdvice: "", nextFocus: "", periodStart: daysAgo(90), periodEnd: today(), periodSummary: "", progress: "", problems: "", goals: "", suggestions: "", content: "", shortContent: "", standardContent: "", status: "draft", evidenceRefs: [] as Array<Record<string, any>> });

function feedbackText(form: Record<string, any>) {
  if (form.type === "lesson") return generateFeedback(form, form.lengthMode === "standard" ? "standard" : "short", form.audience === "group" ? "group" : "private");
  const stage = [
    `阶段总结：${form.periodSummary || "待补充"}`,
    `本阶段进步：${form.progress || "待补充"}`,
    `需要解决的问题：${form.problems || "待补充"}`,
    `下一阶段目标：${form.goals || "待补充"}`,
    `具体建议：${form.suggestions || "待补充"}`,
  ];
  const body = stage.join("\n\n");
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
  const [filter, setFilter] = useState(""), [statusFilter, setStatusFilter] = useState(""), [lessonFilter, setLessonFilter] = useState(""), [studentFilter, setStudentFilter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<Row[]>([]), [templateName, setTemplateName] = useState("");

  const load = useCallback(async () => {
    const [f, l, s, c, t] = await Promise.all([
      fetch(`/api/feedback?${new URLSearchParams({ type: filter, status: statusFilter, lessonId: lessonFilter, studentId: studentFilter })}`).then((r) => r.json()),
      fetch("/api/lessons").then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
      fetch("/api/feedback/templates").then((r) => r.json()),
    ]);
    setRows(f.feedback || []); setLessons(l.lessons || []); setStudents(s.students || []); setClasses(c.classes || []); setTemplates(t.templates || []);
  }, [filter, statusFilter, lessonFilter, studentFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search), lesson = params.get("lesson"), student = params.get("student"), requestedType = params.get("type"); setFilter(requestedType === "lesson" || requestedType === "stage" ? requestedType : ""); setStatusFilter(params.get("status") || ""); setLessonFilter(params.get("lessonId") || ""); setStudentFilter(params.get("studentId") || "");
    if (lesson) fetch(`/api/lessons/${lesson}`).then((r) => r.json()).then((data) => {
      if (!data.lesson) return;
      setForm({ ...blank(), lessonId: lesson, classId: String(data.lesson.classId || ""), learningContent: data.lesson.actualContent || data.lesson.topic || "", homeworkRequirements: data.lesson.homework || "", nextFocus: data.lesson.nextPlan || "" });
      setOpen(true);
    });
    else if (params.get("new") === "1") { setForm({ ...blank(), type: requestedType === "stage" ? "stage" : "lesson", studentId: student || "" }); setOpen(true); }
  }, []);

  const save = async (status: string) => {
    setBusy(true); setMessage("");
    const student = students.find((item) => item.id === Number(form.studentId)), lesson = lessons.find((item) => item.id === Number(form.lessonId));
    const source = { ...form, studentName: student?.name, lessonDate: lesson?.date, startTime: lesson?.startTime, endTime: lesson?.endTime };
    const shortContent = form.type === "lesson" ? generateFeedback(source, "short", form.audience === "group" ? "group" : "private") : feedbackText(form), standardContent = form.type === "lesson" ? generateFeedback(source, "standard", form.audience === "group" ? "group" : "private") : feedbackText(form);
    const payload = { ...form, shortContent, standardContent, content: form.lengthMode === "standard" ? standardContent : shortContent, status };
    const response = await fetch(editing ? `/api/feedback/${editing}` : "/api/feedback", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "保存失败，请检查必填信息后重试"); return; }
    setOpen(false); setEditing(null); setForm(blank()); setMessage(status === "confirmed" ? "反馈已确认，可复制或打印" : "反馈草稿已保存"); load();
  };
  const applyTemplate = () => { if (form.type === "lesson") { const lesson = lessons.find((item) => item.id === Number(form.lessonId)); if (!lesson) { setMessage("请先关联一节已有课时，再整理真实记录"); return; } setForm({ ...form, learningContent: form.learningContent || lesson.actualContent || lesson.topic || "", homeworkRequirements: form.homeworkRequirements || lesson.homework || "", nextFocus: form.nextFocus || lesson.nextPlan || "", evidenceRefs: form.evidenceRefs?.length ? form.evidenceRefs : [{ sourceType: "lesson", sourceId: lesson.id, label: `${lesson.date} ${lesson.topic || lesson.courseName}`, excerpt: lesson.actualContent || "", sourceDate: lesson.date }] }); setMessage("已带入该课时的现有记录，未补写教材观点或学生结论"); } else setMessage("阶段反馈请使用“汇总真实课时、出勤、作业与测验”，系统不提供无证据的内容模板"); };
  const copyAsTemplate = (item: Row) => { setForm({ ...blank(), ...item, lessonId: "", studentId: "", classId: "", status: "draft", confirmedAt: null, sentAt: null, evidenceRefs: [] }); setEditing(null); setOpen(true); setMessage("已复制为新草稿；证据关联已清空，请重新汇总真实记录"); };
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
  const saveStyleTemplate = async () => { const name = templateName.trim(); if (!name) { setMessage("请先填写个人话术模板名称"); return; } const source = { ...form, studentName: students.find((item) => item.id === Number(form.studentId))?.name, lessonDate: lessons.find((item) => item.id === Number(form.lessonId))?.date }; const response = await fetch("/api/feedback/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, audience: form.audience, tone: form.tone, opening: form.opening, closing: form.closing, styleRules: form.styleRules, exampleText: generateFeedback(source, "standard", form.audience === "group" ? "group" : "private") }) }), payload = await response.json(); if (!response.ok) { setMessage(payload.error || "保存话术模板失败"); return; } setTemplateName(""); setMessage("个人话术模板已保存，可在后续反馈中复用"); load(); };

  const edit = (item: Row) => { setForm({ ...blank(), ...item, lessonId: String(item.lessonId || ""), studentId: String(item.studentId || ""), classId: String(item.classId || ""), evidenceRefs: item.evidence || [] }); setEditing(item.id); setOpen(true); };
  const remove = async (id: number) => { if (!confirm("确认删除这条反馈？删除后不可恢复。")) return; await fetch(`/api/feedback/${id}`, { method: "DELETE" }); load(); };
  const copy = async (item: Row, mode: "short" | "standard" = "short") => { await navigator.clipboard.writeText((mode === "standard" ? item.standardContent : item.shortContent) || item.content || feedbackText(item)); await fetch(`/api/feedback/${item.id}/copied`, { method: "POST" }); setMessage(`${mode === "standard" ? "标准版" : "简短版"}已复制，尚未发送给任何人`); load(); };
  const print = async (id: number) => { if (!confirm("确认打印或导出这条反馈？")) return; await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "feedback", entityId: id }) }); window.print(); };

  return <AppShell title="课程反馈" subtitle="单节课与阶段反馈；生成后由教师逐项编辑确认" actions={<><Link className="secondaryButton" href="/feedback-imports">从反馈建立课时</Link><button className="primaryButton" onClick={() => { setEditing(null); setForm(blank()); setOpen(true); }}>＋ 新建反馈</button></>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <div className="subnav" aria-label="反馈类型筛选"><button className={!filter ? "active" : ""} onClick={() => setFilter("")}>全部反馈</button><button className={filter === "lesson" ? "active" : ""} onClick={() => setFilter("lesson")}>单节课反馈</button><button className={filter === "stage" ? "active" : ""} onClick={() => setFilter("stage")}>阶段反馈</button><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="draft">草稿</option><option value="confirmed">已确认</option></select><select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)}><option value="">全部课时</option>{lessons.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.topic || item.courseName}</option>)}</select></div>
    <section className="feedbackGrid">{rows.length === 0 ? <EmptyState title="还没有反馈" description="可从已完成课时生成草稿，或手动建立阶段反馈。系统不会自动向家长发送消息。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>建立第一条反馈</button>} /> : rows.map((item) => <article className="feedbackCard" key={item.id}>
      <div><span>{item.type === "lesson" ? item.audience === "group" ? "家长群版" : "微信私聊版" : "阶段"}</span><em className={`statusBadge ${item.status}`}>{item.sentAt ? "已发送" : item.copiedAt ? "已复制" : item.status === "confirmed" ? "已确认" : "草稿"}</em></div>
      <h3>{item.studentId ? students.find((s) => s.id === item.studentId)?.name || "学生反馈" : item.classId ? classes.find((c) => c.id === item.classId)?.name || "班级反馈" : "通用反馈"}</h3>
      <pre>{String(item.content || feedbackText(item)).slice(0, 280)}</pre>{item.evidence?.length ? <div className="feedbackEvidence"><b>证据来源</b>{item.evidence.map((evidence: Record<string, any>, index: number) => <span key={`${evidence.sourceType}-${index}`}>{evidence.sourceDate || "日期待补"} · {evidence.label}{evidence.excerpt ? `：${String(evidence.excerpt).slice(0, 90)}` : ""}</span>)}</div> : <div className="feedbackEvidence empty">未关联证据来源</div>}
      <small>创建：{String(item.createdAt || "").slice(0, 16)}　修改：{String(item.updatedAt || "").slice(0, 16)}{item.sentAt ? "　已标记发送" : ""}</small>
      <div className="cardActions"><button onClick={() => edit(item)}>编辑</button><button onClick={() => copyAsTemplate(item)}>用作模板</button><button onClick={() => copy(item, "short")}>复制简短版</button><button onClick={() => copy(item, "standard")}>复制标准版</button>{item.status === "confirmed" && <button disabled={Boolean(item.sentAt)} onClick={() => markSent(item.id)}>{item.sentAt ? "已标记发送" : "标记已发送"}</button>}<button onClick={() => print(item.id)}>打印</button><button onClick={() => remove(item.id)}>删除</button></div>
    </article>)}</section>

    {open && <div className="modalBackdrop" role="presentation"><div className="lessonModal feedbackModal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="modalTitle"><div><p>{editing ? "编辑反馈" : "新建反馈"}</p><h2 id="feedback-title">{form.type === "lesson" ? "单节课反馈" : "阶段反馈"}</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="formGrid">
        <div className="wide summaryAction"><button type="button" className="secondaryButton" onClick={applyTemplate}>使用{form.type === "lesson" ? "单节课" : "阶段"}反馈模板</button><span>模板只填入可编辑的初稿，不替代真实课堂记录。</span></div>
        {form.type === "lesson" && <div className="wide feedbackStyleTools"><label>个人话术<select value="" onChange={(event) => { const template = templates.find((item) => item.id === Number(event.target.value)); if (template) setForm({ ...form, audience: template.audience, tone: template.tone, opening: template.opening || "", closing: template.closing || "", styleRules: template.styleRules || "" }); }}><option value="">选择已保存话术</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.audience === "group" ? "群聊" : "私聊"}</option>)}</select></label><label>新模板名称<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="如：莫老师温和私聊版" /></label><button type="button" className="secondaryButton" onClick={saveStyleTemplate}>保存当前话术风格</button></div>}
        <label>反馈类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="lesson">单节课反馈</option><option value="stage">阶段反馈</option></select></label>
        {form.type === "lesson" && <><label>发送对象<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value, studentId: e.target.value === "group" ? "" : form.studentId })}><option value="private">微信私聊版</option><option value="group">家长群版</option></select></label><label>预览长度<select value={form.lengthMode} onChange={(e) => setForm({ ...form, lengthMode: e.target.value })}><option value="short">简短版（100—150字）</option><option value="standard">标准版（200—300字）</option></select></label></>}
        <label>语气<select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}><option>专业简洁</option><option>温和鼓励</option><option>重点提醒</option></select></label>
        <label>关联课时<select value={form.lessonId} onChange={(e) => { const lesson = lessons.find((x) => x.id === Number(e.target.value)); setForm({ ...form, lessonId: e.target.value, classId: String(lesson?.classId || form.classId), learningContent: lesson?.actualContent || lesson?.topic || form.learningContent, homeworkRequirements: lesson?.homework || form.homeworkRequirements, nextFocus: lesson?.nextPlan || form.nextFocus }); }}><option value="">暂不关联</option>{lessons.map((x) => <option key={x.id} value={x.id}>{x.date} · {x.topic || x.courseName}</option>)}</select></label>
        <label>学生<select value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}><option value="">班级整体</option>{students.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>班级<select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">暂不关联</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {form.type === "lesson" ? <>
          <label>上次作业完成情况<textarea value={form.previousHomework} onChange={(e) => setForm({ ...form, previousHomework: e.target.value })} placeholder="如：按时完成，订正认真" /></label>
          <label>课堂表现<textarea value={form.classPerformance} onChange={(e) => setForm({ ...form, classPerformance: e.target.value })} placeholder="如：听课投入，回答积极" /></label>
          <label className="wide">本节学习内容<textarea value={form.learningContent} onChange={(e) => setForm({ ...form, learningContent: e.target.value })} /></label>
          <label>学生表现亮点<textarea value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} /></label>
          <label>需要巩固的知识点<textarea value={form.consolidate} onChange={(e) => setForm({ ...form, consolidate: e.target.value })} /></label>
          <label>作业与完成要求<textarea value={form.homeworkRequirements} onChange={(e) => setForm({ ...form, homeworkRequirements: e.target.value })} /></label>
          <label>预计提交时间<input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
          <label className="wide">简短补充<textarea value={form.customInput} onChange={(e) => setForm({ ...form, customInput: e.target.value })} placeholder="只需补充一两句话，系统会整理成完整反馈" /></label>
          <label>自定义开头<input value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} placeholder="留空使用默认开头" /></label><label>自定义结尾<input value={form.closing} onChange={(e) => setForm({ ...form, closing: e.target.value })} placeholder="留空使用默认结尾" /></label><label className="wide">个人风格规则<textarea value={form.styleRules} onChange={(e) => setForm({ ...form, styleRules: e.target.value })} placeholder="如：先肯定、少用批评、结尾提醒提交时间；用于后续AI润色参考" /></label>
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
      <div className="feedbackPreview"><b>{form.type === "lesson" ? `${form.audience === "group" ? "家长群" : "微信私聊"}${form.lengthMode === "standard" ? "标准版" : "简短版"}预览` : "反馈文本预览"}</b><pre>{form.type === "lesson" ? generateFeedback({ ...form, studentName: students.find((item) => item.id === Number(form.studentId))?.name, lessonDate: lessons.find((item) => item.id === Number(form.lessonId))?.date, startTime: lessons.find((item) => item.id === Number(form.lessonId))?.startTime, endTime: lessons.find((item) => item.id === Number(form.lessonId))?.endTime }, form.lengthMode === "standard" ? "standard" : "short", form.audience === "group" ? "group" : "private") : feedbackText(form)}</pre><div className="feedbackEvidence"><b>证据来源</b>{form.evidenceRefs?.length ? form.evidenceRefs.map((evidence: Record<string, any>, index: number) => <span key={`${evidence.sourceType}-${index}`}>{evidence.sourceDate || "日期待补"} · {evidence.label}：{String(evidence.excerpt || "").slice(0, 120)}</span>) : <span>暂无；阶段反馈只能保存草稿，不能确认</span>}</div></div>
      <div className="privacyNote">系统只生成可编辑草稿，不会自动发送短信、微信或家长群消息。</div>
      <div className="modalActions"><button disabled={busy} onClick={() => save("draft")}>保存草稿</button><button disabled={busy} className="primaryButton" onClick={() => save("confirmed")}>确认反馈</button></div>
    </div></div>}
  </AppShell>;
}
