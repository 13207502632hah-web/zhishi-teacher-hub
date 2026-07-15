"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/app/components/HardNavigationLink";
import { AppShell, EmptyState } from "../components/AppShell";
import { generateFeedback } from "../lib/feedback-generator";

type Row = Record<string, any> & { id: number; type: string; status: string };
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const alwaysExcluded = ["监护人联系方式", "微信标识", "附件原件与文件地址", "登录、会话和密钥数据"];
const blank = () => ({ type: "lesson", audience: "private", lengthMode: "short", lessonId: "", studentId: "", classId: "", tone: "温和鼓励", opening: "", closing: "", styleRules: "", previousHomework: "", classPerformance: "", weakPoints: "", dueAt: "", customInput: "", learningContent: "", highlights: "", consolidate: "", homeworkRequirements: "", parentAdvice: "", nextFocus: "", reflectionOutline: "", periodStart: daysAgo(90), periodEnd: today(), periodSummary: "", progress: "", problems: "", goals: "", suggestions: "", content: "", shortContent: "", standardContent: "", aiGenerated: false, aiDraftId: null as number | null, aiReviewed: false, aiPreviewKey: "", aiSentFields: [] as string[], aiExcludedFields: alwaysExcluded, aiUncertainty: [] as string[], status: "draft", evidenceRefs: [] as Array<Record<string, any>> });

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
  const [pendingAiDrafts, setPendingAiDrafts] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const [f, l, s, c, t, aiDrafts] = await Promise.all([
      fetch(`/api/feedback?${new URLSearchParams({ type: filter, status: statusFilter, lessonId: lessonFilter, studentId: studentFilter })}`).then((r) => r.json()),
      fetch("/api/lessons").then((r) => r.json()),
      fetch("/api/students").then((r) => r.json()),
      fetch("/api/classes").then((r) => r.json()),
      fetch("/api/feedback/templates").then((r) => r.json()),
      fetch("/api/ai/feedback-drafts", { cache: "no-store" }).then(async (r) => r.ok ? r.json() : { drafts: [] }),
    ]);
    setRows(f.feedback || []); setLessons(l.lessons || []); setStudents(s.students || []); setClasses(c.classes || []); setTemplates(t.templates || []); setPendingAiDrafts(aiDrafts.drafts || []);
  }, [filter, statusFilter, lessonFilter, studentFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search), lesson = params.get("lesson"), student = params.get("student"), requestedType = params.get("type"); setFilter(requestedType === "lesson" || requestedType === "stage" ? requestedType : ""); setStatusFilter(params.get("status") || ""); setLessonFilter(params.get("lessonId") || ""); setStudentFilter(params.get("studentId") || "");
    if (lesson) fetch(`/api/lessons/${lesson}`).then((r) => r.json()).then((data) => {
      if (!data.lesson) return;
      setForm({ ...blank(), lessonId: lesson, classId: String(data.lesson.classId || ""), learningContent: data.lesson.actualContent || data.lesson.topic || "", homeworkRequirements: data.lesson.homework || "", nextFocus: data.lesson.nextPlan || "" });
      setOpen(true); if (params.get("ai") === "1") setMessage("课时已带入，请点击“DeepSeek 生成课后闭环草稿”；调用前不会向外部发送数据。");
    });
    else if (params.get("new") === "1") { setForm({ ...blank(), type: requestedType === "stage" ? "stage" : "lesson", studentId: student || "" }); setOpen(true); }
  }, []);

  const save = async (status: string) => {
    if (form.aiGenerated && !form.aiReviewed) { setMessage("请先逐项核对七段 AI 草稿，并勾选教师确认"); return; }
    setBusy(true); setMessage("");
    const student = students.find((item) => item.id === Number(form.studentId)), lesson = lessons.find((item) => item.id === Number(form.lessonId));
    const source = { ...form, studentName: student?.name, lessonDate: lesson?.date, startTime: lesson?.startTime, endTime: lesson?.endTime };
    const generatedShort = form.type === "lesson" ? generateFeedback(source, "short", form.audience === "group" ? "group" : "private") : feedbackText(form), generatedStandard = form.type === "lesson" ? generateFeedback(source, "standard", form.audience === "group" ? "group" : "private") : feedbackText(form);
    const shortContent = form.aiGenerated && form.shortContent ? form.shortContent : generatedShort, standardContent = form.aiGenerated && form.standardContent ? form.standardContent : generatedStandard;
    const payload = { ...form, shortContent, standardContent, content: form.aiGenerated && form.content ? form.content : form.lengthMode === "standard" ? standardContent : shortContent, status, aiReviewed: Boolean(form.aiReviewed) };
    const response = await fetch(editing ? `/api/feedback/${editing}` : "/api/feedback", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.error || "保存失败，请检查必填信息后重试"); return; }
    setOpen(false); setEditing(null); setForm(blank()); setMessage(status === "confirmed" ? "反馈已确认，可复制或打印" : "反馈草稿已保存"); load();
  };
  const applyTemplate = () => { if (form.type === "lesson") { const lesson = lessons.find((item) => item.id === Number(form.lessonId)); if (!lesson) { setMessage("请先关联一节已有课时，再整理真实记录"); return; } setForm({ ...form, learningContent: form.learningContent || lesson.actualContent || lesson.topic || "", homeworkRequirements: form.homeworkRequirements || lesson.homework || "", nextFocus: form.nextFocus || lesson.nextPlan || "", evidenceRefs: form.evidenceRefs?.length ? form.evidenceRefs : [{ sourceType: "lesson", sourceId: lesson.id, label: `${lesson.date} ${lesson.topic || lesson.courseName}`, excerpt: lesson.actualContent || "", sourceDate: lesson.date }] }); setMessage("已带入该课时的现有记录，未补写教材观点或学生结论"); } else setMessage("阶段反馈请使用“汇总真实课时、出勤、作业与测验”，系统不提供无证据的内容模板"); };
  const copyAsTemplate = (item: Row) => { setForm({ ...blank(), ...item, lessonId: "", studentId: "", classId: "", aiDraftId: null, aiGenerated: false, aiReviewed: false, status: "draft", confirmedAt: null, sentAt: null, evidenceRefs: [] }); setEditing(null); setOpen(true); setMessage("已复制为新草稿；证据关联已清空，请重新汇总真实记录"); };
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
  const generateAiDraft = async () => {
    if (!form.lessonId) { setMessage("请先选择关联课时"); return; }
    const requestBody = { lessonId: form.lessonId, studentId: form.studentId, audience: form.audience, tone: form.tone, previousHomework: form.previousHomework, classPerformance: form.classPerformance, weakPoints: form.weakPoints, customInput: form.customInput }, previewKey = JSON.stringify(requestBody);
    setBusy(true);
    if (form.aiPreviewKey !== previewKey) {
      setMessage("正在计算本次实际发送字段，尚未调用 DeepSeek…");
      const response = await fetch("/api/ai/feedback-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestBody, preview: true }) }), result = await response.json();
      setBusy(false); if (!response.ok) { setMessage(result.error || "无法计算发送字段"); return; }
      setForm({ ...form, aiPreviewKey: previewKey, aiSentFields: result.sentFields || [], aiExcludedFields: result.excludedFields || alwaysExcluded });
      setMessage("实际发送字段已列出。请先核对，确认后再次点击生成；此时尚未调用 DeepSeek。"); return;
    }
    setMessage("正在调用 DeepSeek 整理真实课堂记录…");
    const response = await fetch("/api/ai/feedback-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }), result = await response.json();
    setBusy(false); if (!response.ok) { setMessage(result.error || "AI 草稿生成失败，原课时、反馈和作业数据均未改变"); return; }
    const draft = result.draft || {}, lesson = lessons.find((item) => item.id === Number(form.lessonId)); setForm({ ...form, ...draft, aiGenerated: true, aiDraftId: Number(draft.aiDraftId || 0) || null, aiReviewed: false, aiPreviewKey: previewKey, aiSentFields: result.sentFields || [], aiExcludedFields: result.excludedFields || alwaysExcluded, aiUncertainty: draft.uncertainty || [], evidenceRefs: form.evidenceRefs?.length ? form.evidenceRefs : lesson ? [{ sourceType: "lesson", sourceId: lesson.id, label: `${lesson.date} ${lesson.topic || lesson.courseName}`, excerpt: lesson.actualContent || "", sourceDate: lesson.date }] : [] }); setMessage("DeepSeek 草稿已进入可恢复队列；请逐项核对七段内容后再保存或确认"); void load();
  };
  const resumeAiDraft = (item: Row) => { const lesson = lessons.find((row) => Number(row.id) === Number(item.lessonId)); setEditing(null); setForm({ ...blank(), ...(item.draft || {}), lessonId: String(item.lessonId || ""), studentId: String(item.studentId || ""), classId: String(lesson?.classId || ""), aiGenerated: true, aiDraftId: Number(item.id), aiReviewed: false, aiSentFields: item.sentFields || [], aiExcludedFields: alwaysExcluded, aiUncertainty: item.draft?.uncertainty || [], evidenceRefs: lesson ? [{ sourceType: "lesson", sourceId: lesson.id, label: `${lesson.date} ${lesson.topic || lesson.courseName}`, excerpt: lesson.actualContent || "", sourceDate: lesson.date }] : [] }); setOpen(true); setMessage("已恢复未确认 AI 草稿，请继续逐项核对"); };
  const discardAiDraft = async (id: number) => { if (!confirm("确认放弃这份 AI 草稿？原课时和正式反馈不会被修改。")) return; const response = await fetch("/api/ai/feedback-drafts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }), result = await response.json(); if (!response.ok) { setMessage(result.error || "放弃草稿失败"); return; } if (Number(form.aiDraftId) === id) { setForm(blank()); setOpen(false); } setMessage("AI 草稿已放弃，原始业务数据未改变"); void load(); };

  const edit = (item: Row) => { setForm({ ...blank(), ...item, lessonId: String(item.lessonId || ""), studentId: String(item.studentId || ""), classId: String(item.classId || ""), aiGenerated: Boolean(item.aiDraftId), aiReviewed: !item.aiDraftId, evidenceRefs: item.evidence || [] }); setEditing(item.id); setOpen(true); };
  const remove = async (id: number) => { if (!confirm("确认删除这条反馈？删除后不可恢复。")) return; await fetch(`/api/feedback/${id}`, { method: "DELETE" }); load(); };
  const copy = async (item: Row, mode: "short" | "standard" = "short") => { const response = await fetch(`/api/feedback/${item.id}/copied`, { method: "POST" }), result = await response.json(); if (!response.ok) { setMessage(result.error || "请先确认反馈内容"); return; } await navigator.clipboard.writeText((mode === "standard" ? item.standardContent : item.shortContent) || item.content || feedbackText(item)); setMessage(`${mode === "standard" ? "标准版" : "简短版"}已复制，尚未发送给任何人`); load(); };
  const print = async (id: number) => { if (!confirm("确认打印或导出这条反馈？")) return; await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "feedback", entityId: id }) }); window.print(); };

  return <AppShell title="课程反馈" subtitle="单节课与阶段反馈；生成后由教师逐项编辑确认" actions={<><Link className="secondaryButton" href="/feedback-imports">从反馈建立课时</Link><button className="primaryButton" onClick={() => { setEditing(null); setForm(blank()); setOpen(true); }}>＋ 新建反馈</button></>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <div className="subnav" aria-label="反馈类型筛选"><button className={!filter ? "active" : ""} onClick={() => setFilter("")}>全部反馈</button><button className={filter === "lesson" ? "active" : ""} onClick={() => setFilter("lesson")}>单节课反馈</button><button className={filter === "stage" ? "active" : ""} onClick={() => setFilter("stage")}>阶段反馈</button><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="draft">草稿</option><option value="confirmed">已确认</option></select><select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)}><option value="">全部课时</option>{lessons.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.topic || item.courseName}</option>)}</select></div>
    {pendingAiDrafts.length > 0 && <section className="panel aiDraftQueue"><div className="panelTitle"><div><p>教师待办 · 可恢复</p><h2>待确认 AI 反馈草稿（{pendingAiDrafts.length}）</h2></div></div><div className="cardActions">{pendingAiDrafts.map((item) => <span key={item.id}><button onClick={() => resumeAiDraft(item)}>{item.date || "课时"} · {item.studentName || item.courseName || "班级草稿"}</button><button onClick={() => discardAiDraft(item.id)}>放弃</button></span>)}</div></section>}
    <section className="feedbackGrid">{rows.length === 0 ? <EmptyState title="还没有反馈" description="可从已完成课时生成草稿，或手动建立阶段反馈。系统不会自动向家长发送消息。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>建立第一条反馈</button>} /> : rows.map((item) => <article className="feedbackCard" key={item.id}>
      <div><span>{item.type === "lesson" ? item.audience === "group" ? "家长群版" : "微信私聊版" : "阶段"}</span><em className={`statusBadge ${item.status}`}>{item.sentAt ? "已发送" : item.copiedAt ? "已复制" : item.status === "confirmed" ? "已确认" : "草稿"}</em></div>
      <h3>{item.studentId ? students.find((s) => s.id === item.studentId)?.name || "学生反馈" : item.classId ? classes.find((c) => c.id === item.classId)?.name || "班级反馈" : "通用反馈"}</h3>
      <pre>{String(item.content || feedbackText(item)).slice(0, 280)}</pre>{item.evidence?.length ? <div className="feedbackEvidence"><b>证据来源</b>{item.evidence.map((evidence: Record<string, any>, index: number) => <span key={`${evidence.sourceType}-${index}`}>{evidence.sourceDate || "日期待补"} · {evidence.label}{evidence.excerpt ? `：${String(evidence.excerpt).slice(0, 90)}` : ""}</span>)}</div> : <div className="feedbackEvidence empty">未关联证据来源</div>}
      <small>创建：{String(item.createdAt || "").slice(0, 16)}　修改：{String(item.updatedAt || "").slice(0, 16)}{item.sentAt ? "　已标记发送" : ""}</small>
      <div className="cardActions"><button onClick={() => edit(item)}>编辑</button>{item.status === "confirmed" && <><button onClick={() => copyAsTemplate(item)}>用作模板</button><button onClick={() => copy(item, "short")}>复制简短版</button><button onClick={() => copy(item, "standard")}>复制标准版</button><button disabled={Boolean(item.sentAt)} onClick={() => markSent(item.id)}>{item.sentAt ? "已标记发送" : "标记已发送"}</button><button onClick={() => print(item.id)}>打印</button></>}<button onClick={() => remove(item.id)}>删除</button></div>
    </article>)}</section>

    {open && <div className="modalBackdrop" role="presentation"><div className="lessonModal feedbackModal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="modalTitle"><div><p>{editing ? "编辑反馈" : "新建反馈"}</p><h2 id="feedback-title">{form.type === "lesson" ? "单节课反馈" : "阶段反馈"}</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="formGrid">
        <div className="wide summaryAction"><button type="button" className="secondaryButton" onClick={applyTemplate}>使用{form.type === "lesson" ? "单节课" : "阶段"}反馈模板</button>{form.type === "lesson" && <button type="button" className="aiButton" disabled={busy || !form.lessonId || form.aiGenerated} onClick={generateAiDraft}>{busy ? "处理中…" : form.aiPreviewKey ? "已核对字段，调用 DeepSeek 生成" : "先核对发送字段"}</button>}<span>模板或 AI 只填入可编辑初稿，不替代真实课堂记录。</span></div>
        {form.type === "lesson" && <div className="wide privacyNote"><b>本次实际发送字段：</b>{form.aiSentFields?.length ? form.aiSentFields.join("、") : "请先点击“先核对发送字段”，服务器会按当前课时与学生精确计算，且不会调用 DeepSeek"}。<br /><b>永不发送：</b>{(form.aiExcludedFields || alwaysExcluded).join("、")}。</div>}
        {form.type === "lesson" && <div className="wide feedbackStyleTools"><label>个人话术<select value="" onChange={(event) => { const template = templates.find((item) => item.id === Number(event.target.value)); if (template) setForm({ ...form, audience: template.audience, tone: template.tone, opening: template.opening || "", closing: template.closing || "", styleRules: template.styleRules || "" }); }}><option value="">选择已保存话术</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.audience === "group" ? "群聊" : "私聊"}</option>)}</select></label><label>新模板名称<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="如：莫老师温和私聊版" /></label><button type="button" className="secondaryButton" onClick={saveStyleTemplate}>保存当前话术风格</button></div>}
        <label>反馈类型<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="lesson">单节课反馈</option><option value="stage">阶段反馈</option></select></label>
        {form.type === "lesson" && <><label>发送对象<select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value, studentId: e.target.value === "group" ? "" : form.studentId })}><option value="private">微信私聊版</option><option value="group">家长群版</option></select></label><label>预览长度<select value={form.lengthMode} onChange={(e) => setForm({ ...form, lengthMode: e.target.value })}><option value="short">简短版（100—150字）</option><option value="standard">标准版（200—300字）</option></select></label></>}
        <label>语气<select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })}><option>专业简洁</option><option>温和鼓励</option><option>重点提醒</option></select></label>
        <label>关联课时<select disabled={form.aiGenerated} value={form.lessonId} onChange={(e) => { const lesson = lessons.find((x) => x.id === Number(e.target.value)); setForm({ ...form, lessonId: e.target.value, classId: String(lesson?.classId || form.classId), learningContent: lesson?.actualContent || lesson?.topic || form.learningContent, homeworkRequirements: lesson?.homework || form.homeworkRequirements, nextFocus: lesson?.nextPlan || form.nextFocus, aiPreviewKey: "", aiSentFields: [] }); }}><option value="">暂不关联</option>{lessons.map((x) => <option key={x.id} value={x.id}>{x.date} · {x.topic || x.courseName}</option>)}</select></label>
        <label>学生<select disabled={form.aiGenerated} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value, aiPreviewKey: "", aiSentFields: [] })}><option value="">班级整体</option>{students.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>班级<select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">暂不关联</option>{classes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {form.type === "lesson" ? <>
          <label>上次作业完成情况<textarea value={form.previousHomework} onChange={(e) => setForm({ ...form, previousHomework: e.target.value })} placeholder="如：按时完成，订正认真" /></label>
          <label>课堂表现<textarea value={form.classPerformance} onChange={(e) => setForm({ ...form, classPerformance: e.target.value })} placeholder="如：听课投入，回答积极" /></label>
          <label className="wide">课堂小结<textarea value={form.learningContent} onChange={(e) => setForm({ ...form, learningContent: e.target.value })} /></label>
          <label>表现亮点<textarea value={form.highlights} onChange={(e) => setForm({ ...form, highlights: e.target.value })} /></label>
          <label>需要巩固<textarea value={form.consolidate} onChange={(e) => setForm({ ...form, consolidate: e.target.value })} /></label>
          <label>作业建议<textarea value={form.homeworkRequirements} onChange={(e) => setForm({ ...form, homeworkRequirements: e.target.value })} /></label>
          <label>预计提交时间<input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
          <label className="wide">简短补充<textarea value={form.customInput} onChange={(e) => setForm({ ...form, customInput: e.target.value })} placeholder="只需补充一两句话，系统会整理成完整反馈" /></label>
          <label>自定义开头<input value={form.opening} onChange={(e) => setForm({ ...form, opening: e.target.value })} placeholder="留空使用默认开头" /></label><label>自定义结尾<input value={form.closing} onChange={(e) => setForm({ ...form, closing: e.target.value })} placeholder="留空使用默认结尾" /></label><label className="wide">个人风格规则<textarea value={form.styleRules} onChange={(e) => setForm({ ...form, styleRules: e.target.value })} placeholder="如：先肯定、少用批评、结尾提醒提交时间；用于后续AI润色参考" /></label>
          <label>家长沟通稿<textarea value={form.parentAdvice} onChange={(e) => setForm({ ...form, parentAdvice: e.target.value })} /></label>
          <label>下节课计划<textarea value={form.nextFocus} onChange={(e) => setForm({ ...form, nextFocus: e.target.value })} /></label>
          <label className="wide">教学反思提纲<textarea value={form.reflectionOutline} onChange={(e) => setForm({ ...form, reflectionOutline: e.target.value })} /></label>
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
      <div className="feedbackPreview"><b>{form.type === "lesson" ? `${form.audience === "group" ? "家长群" : "微信私聊"}${form.lengthMode === "standard" ? "标准版" : "简短版"}预览${form.aiGenerated ? " · AI 未发布草稿" : ""}` : "反馈文本预览"}</b><pre>{form.aiGenerated && form.content ? form.content : form.type === "lesson" ? generateFeedback({ ...form, studentName: students.find((item) => item.id === Number(form.studentId))?.name, lessonDate: lessons.find((item) => item.id === Number(form.lessonId))?.date, startTime: lessons.find((item) => item.id === Number(form.lessonId))?.startTime, endTime: lessons.find((item) => item.id === Number(form.lessonId))?.endTime }, form.lengthMode === "standard" ? "standard" : "short", form.audience === "group" ? "group" : "private") : feedbackText(form)}</pre>{form.aiGenerated && <><label className="aiDraftEditor">教师核对并编辑家长沟通正文<textarea value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value, parentAdvice: event.target.value, shortContent: form.lengthMode === "short" ? event.target.value : form.shortContent, standardContent: form.lengthMode === "standard" ? event.target.value : form.standardContent })} /></label><div className="privacyNote"><b>本次实际发送字段：</b>{form.aiSentFields?.join("、") || "等待生成"}<br /><b>已排除：</b>{form.aiExcludedFields?.join("、") || alwaysExcluded.join("、")}</div><label className="checkLabel"><input type="checkbox" checked={Boolean(form.aiReviewed)} onChange={(event) => setForm({ ...form, aiReviewed: event.target.checked })} />我已逐项核对课堂小结、亮点、巩固、作业、下节计划、家长沟通稿和教学反思提纲</label></>}{form.aiUncertainty?.length > 0 && <div className="aiUncertainty"><b>AI 标记的不确定项</b>{form.aiUncertainty.map((item: string, index: number) => <span key={index}>{item}</span>)}</div>}<div className="feedbackEvidence"><b>证据来源</b>{form.evidenceRefs?.length ? form.evidenceRefs.map((evidence: Record<string, any>, index: number) => <span key={`${evidence.sourceType}-${index}`}>{evidence.sourceDate || "日期待补"} · {evidence.label}：{String(evidence.excerpt || "").slice(0, 120)}</span>) : <span>暂无；阶段反馈只能保存草稿，不能确认</span>}</div></div>
      <div className="privacyNote">系统只生成可编辑草稿，不会自动发送短信、微信或家长群消息。</div>
      <div className="modalActions">{form.aiDraftId && <button disabled={busy} onClick={() => discardAiDraft(Number(form.aiDraftId))}>放弃 AI 草稿</button>}<button disabled={busy || (form.aiGenerated && !form.aiReviewed)} onClick={() => save("draft")}>保存草稿</button><button disabled={busy || (form.aiGenerated && !form.aiReviewed)} className="primaryButton" onClick={() => save("confirmed")}>确认反馈</button></div>
    </div></div>}
  </AppShell>;
}
