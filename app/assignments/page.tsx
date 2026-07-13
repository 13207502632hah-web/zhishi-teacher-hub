"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";

type Row = Record<string, any> & { id: number };
const emptyForm = () => ({ title: "", classId: "", studentIds: [] as number[], lessonId: "", paperId: "", requirements: "", dueAt: "", allowParentSubmit: true, requireRevision: true, status: "draft", assetIds: [] as number[] });
const reviewTags = ["观点不准确", "材料对应不足", "政治术语不规范", "答题层次不清", "采分点缺失"];

export default function AssignmentsPage() {
  const [rows, setRows] = useState<Row[]>([]), [counts, setCounts] = useState<Record<string, number>>({});
  const [classes, setClasses] = useState<Row[]>([]), [students, setStudents] = useState<Row[]>([]), [papers, setPapers] = useState<Row[]>([]), [lessons, setLessons] = useState<Row[]>([]);
  const [status, setStatus] = useState("all"), [classId, setClassId] = useState(""), [query, setQuery] = useState("");
  const [open, setOpen] = useState(false), [form, setForm] = useState<any>(emptyForm()), [files, setFiles] = useState<Row[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Row | null>(null), [submissions, setSubmissions] = useState<Row[]>([]), [review, setReview] = useState<any>({ submissionId: 0, outcome: "completed", score: "", reviewTags: [], teacherNote: "", revisionRequirements: "" });

  const load = useCallback(async () => {
    const params = new URLSearchParams(); if (status !== "all") params.set("status", status); if (classId) params.set("classId", classId); if (query) params.set("q", query);
    const response = await fetch(`/api/assignments?${params}`), data = await response.json();
    if (response.ok) { setRows(data.assignments || []); setCounts(data.counts || {}); }
  }, [status, classId, query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { Promise.all([fetch("/api/classes").then((r) => r.json()), fetch("/api/students").then((r) => r.json()), fetch("/api/papers").then((r) => r.json()), fetch("/api/lessons").then((r) => r.json())]).then(([c, s, p, l]) => { setClasses(c.classes || []); setStudents(s.students || []); setPapers(p.papers || []); setLessons(l.lessons || []); }); }, []);
  const classStudents = useMemo(() => !form.classId ? students : students.filter((student) => !student.classId || Number(student.classId) === Number(form.classId)), [students, form.classId]);

  const uploadFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true); setMessage("正在上传附件…");
    const saved: Row[] = [];
    for (const file of Array.from(list)) {
      const body = new FormData(); body.append("file", file);
      const response = await fetch("/api/assignments/files", { method: "POST", body }), data = await response.json();
      if (!response.ok) { setMessage(data.error || `${file.name} 上传失败`); setBusy(false); return; }
      saved.push(data);
    }
    const next = [...files, ...saved]; setFiles(next); setForm({ ...form, assetIds: next.map((item) => item.id) }); setMessage("附件已暂存；发布或保存草稿后才正式关联"); setBusy(false);
  };

  const save = async (publish: boolean) => {
    setBusy(true); setMessage("");
    const payload = { ...form, classId: Number(form.classId) || null, lessonId: Number(form.lessonId) || null, paperId: Number(form.paperId) || null, dueAt: form.dueAt || null, status: publish ? "published" : "draft", operationId: crypto.randomUUID() };
    const response = await fetch("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "保存失败"); return; }
    setMessage(publish ? `作业已发布给 ${data.recipientCount} 名学生，小程序可在同步后读取` : "作业草稿已保存"); setOpen(false); setForm(emptyForm()); setFiles([]); await load();
  };

  const openReview = async (assignment: Row) => {
    setSelected(assignment); setMessage("");
    const response = await fetch(`/api/assignments/${assignment.id}/submissions`), data = await response.json(); setSubmissions(data.submissions || []);
  };
  const chooseSubmission = (item: Row) => setReview({ submissionId: item.id, outcome: item.status === "revision" ? "revision" : "completed", score: item.score ?? "", reviewTags: item.reviewTags ? String(item.reviewTags).split("、") : [], teacherNote: item.teacherNote || "", revisionRequirements: "" });
  const saveReview = async (confirm: boolean) => {
    if (!selected || !review.submissionId) return;
    setBusy(true); const payload = { ...review, action: confirm ? "confirm-review" : "save-review", score: review.score === "" ? null : Number(review.score), operationId: crypto.randomUUID() };
    const response = await fetch(`/api/assignments/${selected.id}/submissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), data = await response.json(); setBusy(false);
    setMessage(response.ok ? confirm ? "批改已确认并进入小程序同步；需订正时会进入学生待办" : "批改草稿已保存，仅教师可见" : data.error || "批改保存失败");
    if (response.ok) await openReview(selected);
  };

  return <AppShell title="作业中心" subtitle="网站发布、学生提交、教师批改和订正回流使用同一套数据" actions={<button className="primaryButton" onClick={() => { setForm(emptyForm()); setFiles([]); setOpen(true); }}>＋ 新建作业</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <section className="assignmentMetrics" aria-label="作业概览">
      <article><span>作业总数</span><b>{counts.total || 0}</b></article><article><span>草稿</span><b>{counts.draft || 0}</b></article><article><span>待批改</span><b>{counts.pendingReview || 0}</b></article><article><span>需订正</span><b>{counts.revision || 0}</b></article><article><span>已完成提交</span><b>{counts.completed || 0}</b></article>
    </section>
    <section className="assignmentToolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或要求" aria-label="搜索作业" />
      <select value={classId} onChange={(event) => setClassId(event.target.value)} aria-label="按班级筛选"><option value="">全部班级</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选"><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="closed">已关闭</option></select>
      <button onClick={() => load()}>刷新</button>
    </section>
    <section className="assignmentList">{rows.length === 0 ? <EmptyState title="还没有符合条件的作业" description="可从班级、指定学生、课时或整张试卷创建第一份作业。" action={<button className="secondaryButton" onClick={() => setOpen(true)}>新建作业</button>} /> : rows.map((item) => <article key={item.id}>
      <header><div><span className={`statusBadge ${item.status}`}>{item.status === "draft" ? "草稿" : item.status === "closed" ? "已关闭" : "已发布"}</span><h3>{item.title}</h3></div><button className="secondaryButton" onClick={() => openReview(item)}>进入批改</button></header>
      <p>{item.requirements || "未填写额外要求"}</p><div className="assignmentFacts"><span>{item.className || (item.targets?.some((target: any) => target.targetType === "student") ? "指定学生" : "未关联班级")}</span><span>截止 {item.dueAt ? String(item.dueAt).replace("T", " ").slice(0, 16) : "未设置"}</span><span>附件 {item.assetCount || 0}</span></div>
      <footer><span>接收 {item.recipientCount || 0}</span><span>待批改 {item.pendingReviewCount || 0}</span><span>需订正 {item.revisionCount || 0}</span><span>完成 {item.completedCount || 0}</span></footer>
    </article>)}</section>

    {open && <div className="modalBackdrop"><div className="lessonModal assignmentModal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><div className="modalTitle"><div><p>网站与小程序共用</p><h2 id="assignment-title">新建作业</h2></div><button aria-label="关闭" onClick={() => setOpen(false)}>×</button></div>
      <div className="formGrid"><label className="wide">标题<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="如：九年级法治专题整卷训练" /></label><label>班级<select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value, studentIds: [] })}><option value="">不按整班布置</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>截止时间<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label><label>关联课时<select value={form.lessonId} onChange={(event) => setForm({ ...form, lessonId: event.target.value })}><option value="">暂不关联</option>{lessons.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.topic || item.courseName}</option>)}</select></label><label>整张试卷<select value={form.paperId} onChange={(event) => setForm({ ...form, paperId: event.target.value })}><option value="">不关联试卷</option>{papers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="wide">指定学生（选择后只发给所选学生）<select multiple value={form.studentIds.map(String)} onChange={(event) => setForm({ ...form, studentIds: Array.from(event.target.selectedOptions).map((option) => Number(option.value)) })}>{classStudents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.grade || "年级待补"}</option>)}</select></label>
        <label className="wide">作业要求<textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} placeholder="明确完成范围、拍照要求、订正方式和截止时间" /></label><label className="wide">本地附件<input type="file" multiple accept="image/*,audio/*,video/mp4,.pdf,.docx" onChange={(event) => uploadFiles(event.target.files)} />{files.length > 0 && <small>已暂存：{files.map((item) => item.name).join("、")}</small>}</label><label className="checkLabel"><input type="checkbox" checked={form.allowParentSubmit} onChange={(event) => setForm({ ...form, allowParentSubmit: event.target.checked })} />允许家长代交</label><label className="checkLabel"><input type="checkbox" checked={form.requireRevision} onChange={(event) => setForm({ ...form, requireRevision: event.target.checked })} />需要保留订正版</label></div>
      <div className="modalActions"><button className="secondaryButton" disabled={busy} onClick={() => save(false)}>保存草稿</button><button className="primaryButton" disabled={busy || !form.title || (!form.classId && !form.studentIds.length)} onClick={() => save(true)}>确认接收对象并发布</button></div>
    </div></div>}

    {selected && <div className="modalBackdrop"><div className="lessonModal assignmentModal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modalTitle"><div><p>{selected.title}</p><h2 id="review-title">批改工作台</h2></div><button aria-label="关闭" onClick={() => setSelected(null)}>×</button></div>
      <div className="reviewLayout"><aside>{submissions.length === 0 ? <p>还没有接收学生。</p> : submissions.map((item) => <button key={item.id} className={review.submissionId === item.id ? "active" : ""} onClick={() => chooseSubmission(item)}><b>{item.studentName}</b><span>{item.status} · 版本 {item.latestVersion || 0}</span></button>)}</aside><section>{!review.submissionId ? <EmptyState title="选择一名学生" description="查看首版、订正版并保存批改草稿。" /> : <><label>批改结果<select value={review.outcome} onChange={(event) => setReview({ ...review, outcome: event.target.value })}><option value="completed">已完成</option><option value="revision">需订正</option><option value="excellent">优秀</option><option value="incomplete">未完成</option></select></label><label>分数<input type="number" value={review.score} onChange={(event) => setReview({ ...review, score: event.target.value })} /></label><fieldset><legend>政治学科快捷标签</legend>{reviewTags.map((tag) => <label className="checkLabel" key={tag}><input type="checkbox" checked={review.reviewTags.includes(tag)} onChange={(event) => setReview({ ...review, reviewTags: event.target.checked ? [...review.reviewTags, tag] : review.reviewTags.filter((item: string) => item !== tag) })} />{tag}</label>)}</fieldset><label>教师评语<textarea value={review.teacherNote} onChange={(event) => setReview({ ...review, teacherNote: event.target.value })} /></label><label>订正要求<textarea value={review.revisionRequirements} onChange={(event) => setReview({ ...review, revisionRequirements: event.target.value })} /></label><div className="modalActions"><button className="secondaryButton" disabled={busy} onClick={() => saveReview(false)}>保存批改草稿</button><button className="primaryButton" disabled={busy} onClick={() => saveReview(true)}>确认批改并回传</button></div></>}</section></div>
    </div></div>}
  </AppShell>;
}
