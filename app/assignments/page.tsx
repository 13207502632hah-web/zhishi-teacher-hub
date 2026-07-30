"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { EmptyState, MetricCard, Panel, StatusBadge } from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";

type Row = Record<string, any> & { id: number };
const emptyForm = () => ({ title: "", classId: "", studentIds: [] as number[], lessonId: "", paperId: "", requirements: "", dueAt: "", allowParentSubmit: true, requireRevision: true, status: "draft", assetIds: [] as number[] });
const reviewTags = ["观点不准确", "材料对应不足", "政治术语不规范", "答题层次不清", "采分点缺失"];
const assignmentTone = (status: string): "neutral" | "success" | "warning" => status === "published" ? "success" : status === "draft" ? "warning" : "neutral";

export default function AssignmentsPage() {
  const [rows, setRows] = useState<Row[]>([]), [counts, setCounts] = useState<Record<string, number>>({});
  const [classes, setClasses] = useState<Row[]>([]), [students, setStudents] = useState<Row[]>([]), [papers, setPapers] = useState<Row[]>([]), [lessons, setLessons] = useState<Row[]>([]);
  const [status, setStatus] = useState("all"), [classId, setClassId] = useState(""), [searchInput, setSearchInput] = useState(""), [query, setQuery] = useState(""), [lessonFilter, setLessonFilter] = useState(""), [submissionStatus, setSubmissionStatus] = useState("");
  const [open, setOpen] = useState(false), [form, setForm] = useState<any>(emptyForm()), [files, setFiles] = useState<Row[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Row | null>(null), [submissions, setSubmissions] = useState<Row[]>([]), [review, setReview] = useState<any>({ submissionId: 0, outcome: "completed", score: "", reviewTags: [], teacherNote: "", revisionRequirements: "" }), [reviewDirty, setReviewDirty] = useState(false);
  const [loading, setLoading] = useState(true), [assignmentLoadError, setAssignmentLoadError] = useState(""), [referenceLoadError, setReferenceLoadError] = useState(""), [reviewLoadError, setReviewLoadError] = useState(""), [reloadKey, setReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null), previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false), createDirtyRef = useRef(false), reviewDirtyRef = useRef(false);
  const createDirty = Boolean(form.title || form.classId || form.studentIds.length || form.lessonId || form.paperId || form.requirements || form.dueAt || files.length || !form.allowParentSubmit || !form.requireRevision);
  useEffect(() => {
    busyRef.current = busy; createDirtyRef.current = createDirty; reviewDirtyRef.current = reviewDirty;
  }, [busy, createDirty, reviewDirty]);

  const openCreate = () => {
    if (busy) return;
    setForm(emptyForm()); setFiles([]); setOpen(true);
  };
  const dismissCreate = useCallback(() => {
    if (busyRef.current) return;
    if (createDirtyRef.current && !window.confirm("这份作业尚未保存，确定放弃当前填写内容吗？")) return;
    setOpen(false); setForm(emptyForm()); setFiles([]);
  }, []);
  const dismissReview = useCallback(() => {
    if (busyRef.current) return;
    if (reviewDirtyRef.current && !window.confirm("当前批改内容尚未保存，确定离开吗？")) return;
    setSelected(null); setReviewDirty(false);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setAssignmentLoadError("");
    const params = new URLSearchParams(); if (status !== "all") params.set("status", status); if (classId) params.set("classId", classId); if (query) params.set("q", query); if (lessonFilter) params.set("lessonId", lessonFilter); if (submissionStatus) params.set("submissionStatus", submissionStatus);
    try {
      const data = await requestJson<{ assignments?: Row[]; counts?: Record<string, number> }>(`/api/assignments?${params}`, { signal });
      if (!data) throw new HttpError(200, "作业列表响应为空，请重试");
      setRows(data.assignments || []); setCounts(data.counts || {});
    } catch (reason) {
      if (!signal?.aborted) setAssignmentLoadError(reason instanceof HttpError ? reason.message : "暂时无法读取作业");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [status, classId, query, lessonFilter, submissionStatus]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, reloadKey]);
  useEffect(() => { const params = new URLSearchParams(location.search); setStatus(params.get("status") || "all"); setClassId(params.get("classId") || ""); setLessonFilter(params.get("lessonId") || ""); setSubmissionStatus(params.get("submissionStatus") || ""); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setReferenceLoadError("");
    void Promise.all([
      requestJson<{ classes?: Row[] }>("/api/classes", { signal: controller.signal }),
      requestJson<{ students?: Row[] }>("/api/students", { signal: controller.signal }),
      requestJson<{ papers?: Row[] }>("/api/papers", { signal: controller.signal }),
      requestJson<{ lessons?: Row[] }>("/api/lessons", { signal: controller.signal }),
    ]).then(([c, s, p, l]) => {
      if (!c || !s || !p || !l) throw new HttpError(200, "作业基础选项响应为空");
      setClasses(c.classes || []); setStudents(s.students || []); setPapers(p.papers || []); setLessons(l.lessons || []);
    }).catch((reason) => {
      if (!controller.signal.aborted) setReferenceLoadError(reason instanceof HttpError ? reason.message : "暂时无法读取班级、学生、试卷或课时");
    });
    return () => controller.abort();
  }, [reloadKey]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    (focusable[0] || dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (open) dismissCreate(); else dismissReview();
        return;
      }
      if (event.key === "Tab") {
        const current = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
        if (!current.length) { event.preventDefault(); dialog.focus(); return; }
        const first = current[0], last = current[current.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, selected, dismissCreate, dismissReview]);
  useEffect(() => {
    if (!open && !selected) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if ((open && createDirtyRef.current) || (selected && reviewDirtyRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [open, selected]);
  const classStudents = useMemo(() => !form.classId ? students : students.filter((student) => !student.classId || Number(student.classId) === Number(form.classId)), [students, form.classId]);

  const uploadFiles = async (list: FileList | null) => {
    if (busy) return;
    if (!list?.length) return;
    setBusy(true); setMessage("正在上传附件…");
    try {
      const saved: Row[] = [];
      for (const file of Array.from(list)) {
        const body = new FormData(); body.append("file", file);
        const data = await requestJson<Row>("/api/assignments/files", { method: "POST", body });
        if (!data?.id) throw new HttpError(200, `${file.name} 上传响应为空`);
        saved.push(data);
      }
      const next = [...files, ...saved]; setFiles(next); setForm({ ...form, assetIds: next.map((item) => item.id) }); setMessage("附件已暂存；发布或保存草稿后才正式关联");
    } catch (reason) {
      setMessage(reason instanceof HttpError ? reason.message : "附件上传失败");
    } finally {
      setBusy(false);
    }
  };

  const save = async (publish: boolean) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const payload = { ...form, classId: Number(form.classId) || null, lessonId: Number(form.lessonId) || null, paperId: Number(form.paperId) || null, dueAt: form.dueAt || null, status: publish ? "published" : "draft", operationId: crypto.randomUUID() };
      const data = await requestJson<Record<string, any>>("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!data) throw new HttpError(200, "作业保存响应为空，请重试");
      setMessage(publish ? `作业已发布给 ${data.recipientCount} 名学生，小程序可在同步后读取` : "作业草稿已保存"); setOpen(false); setForm(emptyForm()); setFiles([]); setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(reason instanceof HttpError ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const openReview = async (assignment: Row) => {
    if (busy) return;
    setSelected(assignment); setReviewDirty(false); setMessage(""); setReviewLoadError(""); setBusy(true);
    try {
      const data = await requestJson<{ submissions?: Row[] }>(`/api/assignments/${assignment.id}/submissions`);
      if (!data) throw new HttpError(200, "提交记录响应为空，请重试");
      setSubmissions(data.submissions || []);
    } catch (reason) {
      setReviewLoadError(reason instanceof HttpError ? reason.message : "暂时无法读取学生提交");
      setSubmissions([]);
    } finally {
      setBusy(false);
    }
  };
  const chooseSubmission = (item: Row) => {
    if (reviewDirty && !window.confirm("当前批改内容尚未保存，确定切换学生吗？")) return;
    setReview({ submissionId: item.id, outcome: item.status === "revision" ? "revision" : "completed", score: item.score ?? "", reviewTags: item.reviewTags ? String(item.reviewTags).split("、") : [], teacherNote: item.teacherNote || "", revisionRequirements: "" });
    setReviewDirty(false);
  };
  const updateReview = (changes: Record<string, unknown>) => {
    setReview({ ...review, ...changes });
    setReviewDirty(true);
  };
  const saveReview = async (confirm: boolean) => {
    if (busy) return;
    if (!selected || !review.submissionId) return;
    setBusy(true); setMessage("");
    try {
      const payload = { ...review, action: confirm ? "confirm-review" : "save-review", score: review.score === "" ? null : Number(review.score), operationId: crypto.randomUUID() };
      const data = await requestJson<Record<string, any>>(`/api/assignments/${selected.id}/submissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!data) throw new HttpError(200, "批改保存响应为空，请重试");
      setMessage(confirm ? "批改已确认并进入小程序同步；需订正时会进入学生待办" : "批改草稿已保存，仅教师可见");
      setReviewDirty(false);
      const refreshed = await requestJson<{ submissions?: Row[] }>(`/api/assignments/${selected.id}/submissions`);
      if (refreshed) setSubmissions(refreshed.submissions || []);
    } catch (reason) {
      setMessage(reason instanceof HttpError ? reason.message : "批改保存失败");
    } finally {
      setBusy(false);
    }
  };

  return <AppShell title="作业中心" subtitle="布置、提交、批改与订正回流使用同一份教学记录" actions={<button className="primaryButton" disabled={busy} onClick={openCreate}>＋ 新建作业</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    {loading && <div className="assignmentLoading" role="status">正在整理作业与提交进度…</div>}
    {(assignmentLoadError || referenceLoadError) && <div className="assignmentLoadError" role="alert"><div><strong>作业信息暂时没有完整读取</strong><p>{[assignmentLoadError, referenceLoadError].filter(Boolean).join("；")}</p></div><button className="secondaryButton" onClick={() => setReloadKey((value) => value + 1)}>重新读取作业</button></div>}
    <section className="assignmentMetrics" aria-label="作业概览">
      <MetricCard label="作业总数" value={counts.total || 0} detail="当前筛选范围" />
      <MetricCard label="草稿" value={counts.draft || 0} detail="尚未发布" />
      <MetricCard label="待批改" value={counts.pendingReview || 0} detail="需要教师处理" />
      <MetricCard label="需订正" value={counts.revision || 0} detail="已回流学生待办" />
      <MetricCard label="已完成提交" value={counts.completed || 0} detail="批改已确认" />
    </section>
    <Panel className="assignmentFilterPanel" eyebrow="作业筛选" title="找到需要处理的作业" description="关键词在提交搜索后才请求；班级、状态和课时筛选会立即更新。">
      <form className="assignmentToolbar" aria-label="作业筛选" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); }}>
        <label className="assignmentSearchField">关键词<input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索标题或要求" aria-label="搜索作业" /></label>
        <button className="secondaryButton" type="submit">搜索</button>
        <label>班级<select value={classId} onChange={(event) => setClassId(event.target.value)} aria-label="按班级筛选"><option value="">全部班级</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>作业状态<select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="按状态筛选"><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="closed">已关闭</option></select></label>
        <label>关联课时<select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)} aria-label="按课时筛选"><option value="">全部课时</option>{lessons.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.topic || item.courseName}</option>)}</select></label>
        <label>提交状态<select value={submissionStatus} onChange={(event) => setSubmissionStatus(event.target.value)} aria-label="按提交状态筛选"><option value="">全部提交状态</option><option value="pending">待完成、订正或批改</option><option value="submitted">待批改</option><option value="revision">待订正</option><option value="completed">已完成</option></select></label>
      </form>
    </Panel>
    <Panel className="assignmentListPanel" eyebrow="作业安排" title="作业列表" description={`当前显示 ${rows.length} 份作业`}>
      <div className="assignmentList">{rows.length === 0 ? <EmptyState title="还没有符合条件的作业" description="可从班级、指定学生、课时或整张试卷创建第一份作业。" action={<button className="secondaryButton" onClick={openCreate}>新建作业</button>} /> : rows.map((item) => <article key={item.id}>
      <header><div><StatusBadge tone={assignmentTone(item.status)}>{item.status === "draft" ? "草稿" : item.status === "closed" ? "已关闭" : "已发布"}</StatusBadge><h3>{item.title}</h3></div><button className="secondaryButton" disabled={busy} onClick={() => openReview(item)}>进入批改</button></header>
      <p>{item.requirements || "未填写额外要求"}</p><div className="assignmentFacts"><span>{item.className || (item.targets?.some((target: any) => target.targetType === "student") ? "指定学生" : "未关联班级")}</span><span>截止 {item.dueAt ? String(item.dueAt).replace("T", " ").slice(0, 16) : "未设置"}</span><span>附件 {item.assetCount || 0}</span></div>
      <footer><span>接收 {item.recipientCount || 0}</span><span>待批改 {item.pendingReviewCount || 0}</span><span>需订正 {item.revisionCount || 0}</span><span>完成 {item.completedCount || 0}</span></footer>
    </article>)}</div></Panel>

    {open && <div className="modalBackdrop assignmentModalBackdrop"><div ref={dialogRef} tabIndex={-1} className="lessonModal assignmentModal" role="dialog" aria-modal="true" aria-labelledby="assignment-title"><div className="modalTitle"><div><p>网站与小程序共用</p><h2 id="assignment-title">新建作业</h2></div><button aria-label="关闭" disabled={busy} onClick={dismissCreate}>×</button></div>
      <div className="formGrid"><label className="wide">标题<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="如：九年级法治专题整卷训练" /></label><label>班级<select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value, studentIds: [] })}><option value="">不按整班布置</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>截止时间<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label><label>关联课时<select value={form.lessonId} onChange={(event) => setForm({ ...form, lessonId: event.target.value })}><option value="">暂不关联</option>{lessons.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.topic || item.courseName}</option>)}</select></label><label>整张试卷<select value={form.paperId} onChange={(event) => setForm({ ...form, paperId: event.target.value })}><option value="">不关联试卷</option>{papers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="wide">指定学生（选择后只发给所选学生）<select multiple value={form.studentIds.map(String)} onChange={(event) => setForm({ ...form, studentIds: Array.from(event.target.selectedOptions).map((option) => Number(option.value)) })}>{classStudents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.grade || "年级待补"}</option>)}</select></label>
        <label className="wide">作业要求<textarea value={form.requirements} onChange={(event) => setForm({ ...form, requirements: event.target.value })} placeholder="明确完成范围、拍照要求、订正方式和截止时间" /></label><label className="wide">本地附件<input type="file" multiple accept="image/*,audio/*,video/mp4,.pdf,.docx" onChange={(event) => uploadFiles(event.target.files)} />{files.length > 0 && <small>已暂存：{files.map((item) => item.name).join("、")}</small>}</label><label className="checkLabel"><input type="checkbox" checked={form.allowParentSubmit} onChange={(event) => setForm({ ...form, allowParentSubmit: event.target.checked })} />允许家长代交</label><label className="checkLabel"><input type="checkbox" checked={form.requireRevision} onChange={(event) => setForm({ ...form, requireRevision: event.target.checked })} />需要保留订正版</label></div>
      <div className="modalActions"><button className="secondaryButton" disabled={busy} onClick={() => save(false)}>保存草稿</button><button className="primaryButton" disabled={busy || !form.title || (!form.classId && !form.studentIds.length)} onClick={() => save(true)}>确认接收对象并发布</button></div>
    </div></div>}

    {selected && <div className="modalBackdrop assignmentModalBackdrop"><div ref={dialogRef} tabIndex={-1} className="lessonModal assignmentModal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modalTitle"><div><p>{selected.title}</p><h2 id="review-title">批改工作台</h2></div><button aria-label="关闭" disabled={busy} onClick={dismissReview}>×</button></div>
      {reviewLoadError && <div className="assignmentReviewError" role="alert"><span>{reviewLoadError}</span><button className="secondaryButton" disabled={busy} onClick={() => openReview(selected)}>重新读取提交</button></div>}
      <div className="reviewLayout"><aside>{submissions.length === 0 ? <p>还没有接收学生。</p> : submissions.map((item) => <button disabled={busy} key={item.id} className={review.submissionId === item.id ? "active" : ""} onClick={() => chooseSubmission(item)}><b>{item.studentName}</b><span>{item.status} · 版本 {item.latestVersion || 0}</span></button>)}</aside><section>{!review.submissionId ? <EmptyState title="选择一名学生" description="查看首版、订正版并保存批改草稿。" /> : <><label>批改结果<select value={review.outcome} onChange={(event) => updateReview({ outcome: event.target.value })}><option value="completed">已完成</option><option value="revision">需订正</option><option value="excellent">优秀</option><option value="incomplete">未完成</option></select></label><label>分数<input type="number" value={review.score} onChange={(event) => updateReview({ score: event.target.value })} /></label><fieldset><legend>政治学科快捷标签</legend>{reviewTags.map((tag) => <label className="checkLabel" key={tag}><input type="checkbox" checked={review.reviewTags.includes(tag)} onChange={(event) => updateReview({ reviewTags: event.target.checked ? [...review.reviewTags, tag] : review.reviewTags.filter((item: string) => item !== tag) })} />{tag}</label>)}</fieldset><label>教师评语<textarea value={review.teacherNote} onChange={(event) => updateReview({ teacherNote: event.target.value })} /></label><label>订正要求<textarea value={review.revisionRequirements} onChange={(event) => updateReview({ revisionRequirements: event.target.value })} /></label><div className="modalActions"><button className="secondaryButton" disabled={busy} onClick={() => saveReview(false)}>保存批改草稿</button><button className="primaryButton" disabled={busy} onClick={() => saveReview(true)}>确认批改并回传</button></div></>}</section></div>
    </div></div>}
  </AppShell>;
}
