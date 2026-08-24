"use client";

import Link from "../../../components/HardNavigationLink";
import { ClassPicker } from "../../../components/ClassPicker";
import { generateFeedback } from "../../../lib/feedback-generator";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StudentOverviewWorkspace } from "./StudentOverviewWorkspace";
import { ClassOverviewWorkspace } from "./ClassOverviewWorkspace";
import { LessonOverviewWorkspace } from "./LessonOverviewWorkspace";
import { PaperWorkbenchWorkspace } from "./PaperWorkbenchWorkspace";

type ModuleSlug = "students" | "papers" | "assignments" | "learning" | "resources" | "finance";
type Row = Record<string, unknown>;
type WorkspaceData = {
  students: Row[];
  classes: Row[];
  lessons: Row[];
  papers: Row[];
  assignments: Row[];
  assignmentCounts: Row;
  analytics: Row;
  feedback: Row[];
  reflections: Row[];
  resources: Row[];
  resourceSummary: Row;
  finance: Row[];
  financeTotals: Row;
};

const emptyData: WorkspaceData = { students: [], classes: [], lessons: [], papers: [], assignments: [], assignmentCounts: {}, analytics: {}, feedback: [], reflections: [], resources: [], resourceSummary: {}, finance: [], financeTotals: {} };

async function requestJson(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) { const error = new Error(String(payload.error || `请求失败（${response.status}）`)) as Error & { status?: number }; error.status = response.status; throw error; }
  return payload;
}

const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const number = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `¥${number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const includes = (row: Row, query: string, fields: string[]) => !query || fields.some((field) => text(row[field], "").toLowerCase().includes(query.toLowerCase()));
const statusNames: Record<string, string> = { active: "进行中", archived: "已归档", draft: "草稿", scheduled: "待上课", completed: "已完成", cancelled: "已取消", published: "已发布", confirmed: "已确认", submitted: "待批改", revision: "待订正", private: "仅教师", public: "公开", pending: "待处理", underpaid: "少收", overpaid: "多收", review: "待核对", settled: "已结算" };

export function ModuleWorkspace({ slug, initialView, initialQuery, initialLessonId, initialStudentId, initialClassId, initialStatus, initialSubmissionStatus, initialType, initialNew = false, initialAi = false }: { slug: ModuleSlug; initialView?: string; initialQuery?: string; initialLessonId?: string; initialStudentId?: string; initialClassId?: string; initialStatus?: string; initialSubmissionStatus?: string; initialType?: string; initialNew?: boolean; initialAi?: boolean }) {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState(initialQuery || "");
  const [studentTab, setStudentTab] = useState<"students" | "classes" | "lessons">(initialView === "classes" ? "classes" : initialView === "lessons" ? "lessons" : "students");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (slug === "students") {
        setData(emptyData);
      } else if (slug === "assignments") {
        const [assignments, classes, students, lessons, papers] = await Promise.all([requestJson("/api/v2/assignments"), requestJson("/api/v2/classes?status=active&pageSize=200"), requestJson("/api/v2/students?status=active"), requestJson("/api/v2/lessons"), requestJson("/api/v2/papers")]);
        setData({ ...emptyData, assignments: (assignments.assignments || []) as Row[], assignmentCounts: (assignments.counts || {}) as Row, classes: (classes.classes || []) as Row[], students: (students.students || []) as Row[], lessons: (lessons.lessons || []) as Row[], papers: (papers.papers || []) as Row[] });
      } else if (slug === "papers") {
        setData(emptyData);
      } else if (slug === "learning") {
        if (initialView === "analytics" || initialView === "reflections" || initialView === "feedback") setData(emptyData);
        else { const [analytics, feedback, reflections] = await Promise.all([requestJson("/api/v2/analytics?range=month"), requestJson("/api/v2/feedback"), requestJson("/api/v2/reflections")]); setData({ ...emptyData, analytics, feedback: (feedback.feedback || []) as Row[], reflections: (reflections.reflections || []) as Row[] }); }
      } else if (slug === "resources") {
        const resources = await requestJson("/api/v2/resources?scope=all");
        setData({ ...emptyData, resources: (resources.resources || []) as Row[], resourceSummary: (resources.summary || {}) as Row });
      } else {
        const finance = await requestJson("/api/v2/finance");
        setData({ ...emptyData, finance: (finance.items || []) as Row[], financeTotals: (finance.totals || {}) as Row });
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "工作台暂时无法读取数据"); }
    finally { setLoading(false); }
  }, [initialView, slug]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreating(true); setError(""); setNotice("");
    const form = event.currentTarget, formData = new FormData(form);
    const values = Object.fromEntries(formData.entries()) as Record<string, string>;
    try {
      let path = ""; let payload: Row = { ...values };
      if (slug === "learning") { path = "/api/v2/reflections"; payload = { ...values, actionCompleted: false, isStrategy: false }; }
      if (slug === "resources") { path = "/api/v2/resources"; payload = { ...values, visibility: "private", sourceRef: "v2-workspace" }; }
      if (!path) return;
      await requestJson(path, { method: "POST", body: JSON.stringify(payload) });
      form.reset(); setNotice(slug === "assignments" ? "作业草稿已建立，尚未向学生发布。" : "已保存，并写入审计记录。");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setCreating(false); }
  };

  let content: React.ReactNode;
  if (slug === "students") content = <PeopleWorkspace tab={studentTab} setTab={setStudentTab}/>;
  else if (slug === "assignments") content = <AssignmentWorkspace data={data} query={query} reload={load} initialLessonId={initialLessonId} initialClassId={initialClassId} initialStatus={initialStatus} initialSubmissionStatus={initialSubmissionStatus}/>;
  else if (slug === "papers") content = <PaperWorkbenchWorkspace/>;
  else if (slug === "learning") content = <LearningWorkspace data={data} query={query} submit={submit} creating={creating} view={initialView === "analytics" ? "analytics" : initialView === "reflections" ? "reflections" : initialView === "feedback" ? "feedback" : "overview"} initialLessonId={initialLessonId} initialStudentId={initialStudentId} initialStatus={initialStatus} initialType={initialType} initialNew={initialNew} initialAi={initialAi}/>;
  else if (slug === "resources") content = <ResourceWorkspace data={data} query={query} submit={submit} creating={creating}/>;
  else content = <FinanceWorkspaceV2 data={data} query={query} reload={load}/>;

  return <>
    {slug !== "students" && slug !== "papers" && <section className="v2-workspace-toolbar"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前工作台中筛选…"/></label><button onClick={() => void load()} disabled={loading}>↻ 刷新数据</button><small>网页、iOS 与小程序共用同一份 D1/R2 数据</small></section>}
    {error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}
    <div className={loading ? "v2-loading" : ""}>{content}</div>
  </>;
}

function PeopleWorkspace({ tab, setTab }: { tab: "students" | "classes" | "lessons"; setTab: (value: "students" | "classes" | "lessons") => void }) {
  if (tab === "students") return <><section className="v2-card v2-people-switcher"><header className="v2-card-head"><div><h2>教学对象</h2><p>档案、班级与课时在同一上下文切换</p></div><TabBar value={tab} setValue={setTab}/></header></section><StudentOverviewWorkspace/></>;
  if (tab === "classes") return <><section className="v2-card v2-people-switcher"><header className="v2-card-head"><div><h2>教学对象</h2><p>档案、班级与课时在同一上下文切换</p></div><TabBar value={tab} setValue={setTab}/></header></section><ClassOverviewWorkspace/></>;
  return <><section className="v2-card v2-people-switcher"><header className="v2-card-head"><div><h2>教学对象</h2><p>档案、班级与课时在同一上下文切换</p></div><TabBar value={tab} setValue={setTab}/></header></section><LessonOverviewWorkspace/></>;
}

function TabBar({ value, setValue }: { value: "students" | "classes" | "lessons"; setValue: (value: "students" | "classes" | "lessons") => void }) { return <div className="v2-tabs">{[["students", "学生"], ["classes", "班级"], ["lessons", "课时"]].map(([key, label]) => <button className={value === key ? "active" : ""} key={key} onClick={() => setValue(key as typeof value)}>{label}</button>)}</div>; }

function AssignmentWorkspace({ data, query, reload, initialLessonId, initialClassId, initialStatus, initialSubmissionStatus }: { data: WorkspaceData; query: string; reload: () => Promise<void>; initialLessonId?: string; initialClassId?: string; initialStatus?: string; initialSubmissionStatus?: string }) {
  const [statusFilter, setStatusFilter] = useState(initialStatus && initialStatus !== "all" ? initialStatus : "");
  const [classFilter, setClassFilter] = useState(initialClassId || "");
  const [lessonFilter, setLessonFilter] = useState(initialLessonId || "");
  const [submissionFilter, setSubmissionFilter] = useState(initialSubmissionStatus || "");
  const [createClassId, setCreateClassId] = useState(initialClassId || "");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState(0);
  const [submissions, setSubmissions] = useState<Row[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [assets, setAssets] = useState<Array<{ id: number; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [createDirty, setCreateDirty] = useState(false);

  const rows = useMemo(() => data.assignments.filter((row) => {
    if (!includes(row, query, ["title", "requirements", "className", "paperTitle"])) return false;
    if (statusFilter && text(row.status) !== statusFilter) return false;
    if (classFilter && number(row.classId) !== number(classFilter)) return false;
    if (lessonFilter && number(row.lessonId) !== number(lessonFilter)) return false;
    if (submissionFilter === "pending" && number(row.recipientCount) <= number(row.completedCount)) return false;
    if (["submitted", "revision_submitted"].includes(submissionFilter) && number(row.pendingReviewCount) <= 0) return false;
    if (submissionFilter === "revision" && number(row.revisionCount) <= 0) return false;
    if (["completed", "corrected"].includes(submissionFilter) && number(row.completedCount) <= 0) return false;
    return true;
  }), [classFilter, data.assignments, lessonFilter, query, statusFilter, submissionFilter]);
  const counts = useMemo(() => rows.reduce<{ total: number; draft: number; pending: number; revision: number; completed: number }>((all, row) => ({ total: all.total + 1, draft: all.draft + (text(row.status) === "draft" ? 1 : 0), pending: all.pending + number(row.pendingReviewCount), revision: all.revision + number(row.revisionCount), completed: all.completed + number(row.completedCount) }), { total: 0, draft: 0, pending: 0, revision: 0, completed: 0 }), [rows]);
  const visibleSubmissions = submissions.filter((row) => {
    if (!submissionFilter) return true;
    if (submissionFilter === "pending") return !["completed", "corrected"].includes(text(row.status));
    if (["submitted", "revision_submitted"].includes(submissionFilter)) return ["submitted", "revision_submitted"].includes(text(row.status));
    if (["completed", "corrected"].includes(submissionFilter)) return ["completed", "corrected"].includes(text(row.status));
    return text(row.status) === submissionFilter;
  });

  useEffect(() => {
    if (!createDirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [createDirty]);

  useEffect(() => {
    if (!rows.length) { setSelectedId(0); return; }
    if (!rows.some((row) => number(row.id) === selectedId)) setSelectedId(number(rows.find((row) => number(row.pendingReviewCount) > 0)?.id || rows[0].id));
  }, [rows, selectedId]);

  useEffect(() => {
    if (!selectedId) { setSubmissions([]); return; }
    const controller = new AbortController();
    setReviewLoading(true); setReviewError("");
    requestJson(`/api/v2/assignments/${selectedId}/submissions`, { signal: controller.signal })
      .then((payload) => { if (!controller.signal.aborted) setSubmissions((payload.submissions || []) as Row[]); })
      .catch((caught) => { if (!controller.signal.aborted) { setSubmissions([]); setReviewError(caught instanceof Error ? caught.message : "提交队列读取失败"); } })
      .finally(() => { if (!controller.signal.aborted) setReviewLoading(false); });
    return () => controller.abort();
  }, [selectedId]);

  const uploadAssets = async (files: FileList | null) => {
    if (uploading || !files?.length) return;
    setUploading(true); setReviewNotice("");
    try {
      const uploaded: Array<{ id: number; name: string }> = [];
      for (const file of Array.from(files)) {
        const body = new FormData(); body.append("file", file);
        const response = await fetch("/api/v2/assignments/files", { method: "POST", body });
        const payload = await response.json().catch(() => ({})) as Row;
        if (!response.ok) throw new Error(text(payload.error, `${file.name} 上传失败`));
        uploaded.push({ id: number(payload.id), name: text(payload.name, file.name) });
      }
      setAssets((current) => [...current, ...uploaded]); setCreateDirty(true);
    } catch (caught) { setReviewNotice(caught instanceof Error ? caught.message : "附件上传失败"); }
    finally { setUploading(false); }
  };

  const createAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createBusy || uploading) return;
    const form = event.currentTarget, formData = new FormData(form), title = text(formData.get("title"), "");
    if (!title || (!createClassId && !selectedStudentIds.length)) { setReviewNotice("请填写标题，并选择班级或至少一名指定学生。"); return; }
    setCreateBusy(true); setReviewNotice(""); setReviewError("");
    try {
      const payload = {
        title,
        classId: createClassId ? number(createClassId) : null,
        studentIds: selectedStudentIds.map(Number),
        lessonId: formData.get("lessonId") ? number(formData.get("lessonId")) : null,
        paperId: formData.get("paperId") ? number(formData.get("paperId")) : null,
        dueAt: text(formData.get("dueAt"), "") || null,
        requirements: text(formData.get("requirements"), ""),
        status: "draft",
        operationId: crypto.randomUUID(),
        assetIds: assets.map((asset) => asset.id),
        allowParentSubmit: formData.get("allowParentSubmit") === "on",
        requireRevision: formData.get("requireRevision") === "on",
      };
      await requestJson("/api/v2/assignments", { method: "POST", body: JSON.stringify(payload) });
      form.reset(); setCreateClassId(""); setSelectedStudentIds([]); setAssets([]); setCreateDirty(false);
      setReviewNotice("作业草稿已私密保存；发布前仍需在列表中提交确认。");
      await reload();
    } catch (caught) { setReviewNotice(caught instanceof Error ? caught.message : "作业草稿保存失败"); }
    finally { setCreateBusy(false); }
  };

  const requestPublish = async (row: Row) => {
    if (publishBusy) return;
    setPublishBusy(true); setReviewNotice("");
    try {
      await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "assignment.publish", entityType: "assignment", entityId: String(row.id), title: `发布作业：${text(row.title)}`, summary: `向 ${number(row.recipientCount) || "班级内"} 名学生发布，截止时间 ${text(row.dueAt, "未设置")}。`, payload: { id: number(row.id), dueAt: row.dueAt }, evidence: [{ type: "assignment", id: row.id, requirements: row.requirements, targets: row.targets, attachments: row.attachments }] }) });
      setReviewNotice("作业发布已进入待确认中心；当前仍是草稿。");
    } catch (caught) { setReviewNotice(caught instanceof Error ? caught.message : "发布确认创建失败"); }
    finally { setPublishBusy(false); }
  };

  return <>
    <MetricStrip items={[{ label: "当前作业", value: counts.total, detail: "当前筛选范围" }, { label: "草稿", value: counts.draft, detail: "尚未发布" }, { label: "待批改", value: counts.pending, detail: "学生已提交" }, { label: "待订正", value: counts.revision, detail: "需要继续跟进" }, { label: "已完成", value: counts.completed, detail: "教师已确认" }]}/>
    {reviewNotice && <p className="v2-alert" role="status">{reviewNotice}</p>}
    <section className="v2-card v2-assignment-filters" aria-label="作业筛选">
      <header className="v2-card-head"><div><h2>作业教学闭环</h2><p>关键词在本页即时筛选；状态、班级、课时和收交状态可以组合使用</p></div><Status value={`${rows.length} 项`}/></header>
      <div>
        <label>作业状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="closed">已关闭</option></select></label>
        <ClassPicker endpoint="/api/v2/classes/options" includeAll label="班级" value={classFilter} onChange={setClassFilter}/>
        <label>关联课时<select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)}><option value="">全部课时</option>{data.lessons.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.date)} · {text(row.topic, text(row.courseName))}</option>)}</select></label>
        <label>收交状态<select value={submissionFilter} onChange={(event) => setSubmissionFilter(event.target.value)}><option value="">全部收交状态</option><option value="pending">有待处理学生</option><option value="submitted">待批改</option><option value="revision">待订正</option><option value="completed">已完成</option></select></label>
      </div>
    </section>
    <div className="v2-native-layout">
      <section className="v2-card"><div className="v2-native-list">{rows.map((row) => {
        const attachments = Array.isArray(row.attachments) ? row.attachments as Row[] : [];
        return <article key={String(row.id)} className={selectedId === number(row.id) ? "selected" : ""}><div className="v2-avatar">业</div><div><h3>{text(row.title)} <small>{text(row.className, "指定学生")}</small></h3><p>截止 {text(row.dueAt, "未设置")} · {number(row.recipientCount)} 人{text(row.paperTitle, "") ? ` · 试卷：${text(row.paperTitle)}` : ""}</p><span>待批 {number(row.pendingReviewCount)} · 待订正 {number(row.revisionCount)} · 完成 {number(row.completedCount)} · 附件 {attachments.length}</span><div className="v2-inline-actions"><button className="v2-row-inline-button" onClick={() => { setSelectedId(number(row.id)); setReviewNotice(""); }}>查看提交与批改</button>{text(row.status) === "draft" && <button className="v2-row-inline-button" disabled={publishBusy} onClick={() => void requestPublish(row)}>提交发布确认</button>}</div></div><Status value={statusNames[text(row.status)] || text(row.status)}/></article>;
      })}{!rows.length && <Empty title="没有匹配的作业" detail="调整筛选，或从右侧建立一份不会直接发布的草稿。"/>}</div></section>
      <section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>新建作业草稿</h2><p>可按班级或指定学生布置；不会直接出现在学生端</p></div></header><form className="v2-form" onSubmit={createAssignment} onChange={() => setCreateDirty(true)}>
        <label>标题<input name="title" required maxLength={120}/></label>
        <ClassPicker endpoint="/api/v2/classes/options" label="班级（与指定学生二选一）" value={createClassId} onChange={(value) => { setCreateClassId(value); setCreateDirty(true); }} allowClear/>
        <input type="hidden" name="classId" value={createClassId}/>
        <label>指定学生<select name="studentIds" multiple value={selectedStudentIds} onChange={(event) => { setSelectedStudentIds([...event.target.selectedOptions].map((option) => option.value)); setCreateDirty(true); }}>{data.students.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)} · {text(row.grade)}</option>)}</select><small>按住 Ctrl / Command 可多选；选择后以指定学生为准。</small></label>
        <label>关联课时<select name="lessonId" defaultValue={initialLessonId || ""}><option value="">暂不关联</option>{data.lessons.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.date)} · {text(row.topic, text(row.courseName))}</option>)}</select></label>
        <label>关联试卷<select name="paperId"><option value="">暂不关联</option>{data.papers.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.title)} · {number(row.questionCount)} 题</option>)}</select></label>
        <label>截止时间<input name="dueAt" type="datetime-local"/></label>
        <label>完成要求<textarea name="requirements" rows={5}/></label>
        <label className="v2-file-picker">作业附件<input type="file" multiple accept="image/*,audio/*,video/mp4,.pdf,.docx" onChange={(event) => void uploadAssets(event.target.files)}/><small>{uploading ? "上传中…" : assets.length ? assets.map((item) => item.name).join("、") : "图片、语音、视频、PDF 或 Word，单个 25MB 以内"}</small></label>
        <label className="v2-check"><input type="checkbox" name="allowParentSubmit" defaultChecked/>允许家长代交</label>
        <label className="v2-check"><input type="checkbox" name="requireRevision" defaultChecked/>需要保留订正版</label>
        <button className="v2-primary" disabled={createBusy || uploading}>{createBusy ? "保存中…" : "保存作业草稿"}</button>
        <small className="v2-form-note">正式发布、提醒与学生端同步继续由待确认中心负责。</small>
      </form></section>
    </div>
    {selectedId > 0 && <section className={`v2-card v2-review-queue ${reviewLoading ? "v2-loading" : ""}`}><header className="v2-card-head"><div><h2>提交与批改</h2><p>批改草稿仅教师可见；确认结果先进入待确认中心</p></div><Status value={`${visibleSubmissions.length} 名学生`}/></header>{reviewError && <p className="v2-alert v2-error" role="alert">{reviewError}<button className="v2-row-inline-button" onClick={() => { const current = selectedId; setSelectedId(0); window.setTimeout(() => setSelectedId(current), 0); }}>重新读取提交</button></p>}<div className="v2-review-grid">{visibleSubmissions.map((row) => <SubmissionReviewCard key={String(row.id)} assignmentId={selectedId} row={row} onCreated={(message) => setReviewNotice(message)} />)}{!visibleSubmissions.length && !reviewLoading && <Empty title="暂无匹配的学生提交" detail="作业发布并产生接收人后，这里会显示收交、批改和订正状态。"/>}</div></section>}
  </>;
}
const v2ReviewTagOptions = ["观点准确", "材料对应充分", "政治术语规范", "答题层次清晰", "采分点完整", "观点不准确", "材料对应不足", "政治术语不规范", "答题层次不清", "采分点缺失"];

function SubmissionReviewCard({ assignmentId, row, onCreated }: { assignmentId: number; row: Row; onCreated: (message: string) => void }) {
  const initialTags = text(row.reviewTags, "").split("、").map((item) => item.trim()).filter(Boolean);
  const [busy, setBusy] = useState(false), [aiBusy, setAiBusy] = useState(false), [error, setError] = useState(""), [aiDraft, setAiDraft] = useState<Row | null>(null), [reviewAssets, setReviewAssets] = useState<Array<{ id: number; name: string }>>([]), [draft, setDraft] = useState({ outcome: text(row.status) === "revision" ? "revision" : "completed", score: row.score == null ? "" : String(row.score), reviewTags: initialTags, teacherNote: text(row.teacherNote, ""), revisionRequirements: "", annotation: "" }), attachments = (Array.isArray(row.attachments) ? row.attachments : []) as Row[];
  const uploadReviewAssets = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); setError(""); try { const uploaded: Array<{ id: number; name: string }> = []; for (const file of Array.from(files)) { const body = new FormData(); body.append("file", file); const response = await fetch("/api/v2/assignments/files", { method: "POST", body }); const payload = await response.json().catch(() => ({})) as Row; if (!response.ok) throw new Error(text(payload.error, `${file.name} 上传失败`)); uploaded.push({ id: number(payload.id), name: text(payload.name, file.name) }); } setReviewAssets((current) => [...current, ...uploaded]); } catch (caught) { setError(caught instanceof Error ? caught.message : "批改附件上传失败"); } finally { setBusy(false); } };
  const generateAiReview = async () => {
    setAiBusy(true); setError(""); setAiDraft(null);
    try {
      let result = await requestJson(`/api/v2/assignments/${assignmentId}/submissions/${row.id}/ai-review`, { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID() }) });
      const jobId = text((result.job as Row | undefined)?.id);
      for (let attempt = 0; !result.review && jobId && attempt < 80; attempt++) { await new Promise((resolve) => setTimeout(resolve, 1500)); const status = await requestJson(`/api/v2/jobs/${jobId}`), job = (status.job || {}) as Row; if (text(job.state) === "completed") result = { ...result, ...(job.result as Row || {}) }; else if (["failed", "cancelled"].includes(text(job.state))) throw new Error(text((job.error as Row | undefined)?.message, "AI 批改任务已暂停，请重新生成")); }
      if (!result.review) throw new Error("AI 批改仍在后台运行，可稍后从该提交重新打开结果");
      const suggestion = (result.review || {}) as Row;
      const suggestedScore = suggestion.suggestedScore == null ? "" : String(suggestion.suggestedScore), reviewTags = Array.isArray(suggestion.reviewTags) ? suggestion.reviewTags.map(String).filter(Boolean) : [];
      setDraft({ outcome: text(suggestion.outcome, draft.outcome), score: suggestedScore, reviewTags, teacherNote: text(suggestion.teacherNote, ""), revisionRequirements: text(suggestion.revisionRequirements, ""), annotation: text(suggestion.annotation, "") });
      setAiDraft({ ...suggestion, model: result.model, provider: result.provider, maxScore: result.maxScore });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "AI 批改建议生成失败"); }
    finally { setAiBusy(false); }
  };
  const saveReviewDraft = async () => {
    if (busy || aiBusy) return;
    setBusy(true); setError("");
    try {
      await requestJson(`/api/v2/assignments/${assignmentId}/submissions`, { method: "POST", body: JSON.stringify({ action: "save-review", submissionId: number(row.id), outcome: draft.outcome, score: draft.score === "" ? null : number(draft.score), reviewTags: draft.reviewTags, teacherNote: draft.teacherNote, revisionRequirements: draft.revisionRequirements, operationId: crypto.randomUUID() }) });
      onCreated("批改草稿已私密保存；学生和家长当前不可见。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "批改草稿保存失败"); }
    finally { setBusy(false); }
  };
  const createApproval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "submission.review_confirm", entityType: "submission", entityId: String(row.id), title: `确认 ${text(row.studentName)} 的作业批改`, summary: `${draft.outcome === "revision" ? "要求订正" : "确认完成"}${draft.score ? `，得分 ${draft.score}` : ""}。确认后学生端立即可见。`, payload: { assignmentId, submissionId: number(row.id), outcome: draft.outcome, score: draft.score, reviewTags: draft.reviewTags, teacherNote: draft.teacherNote, revisionRequirements: draft.revisionRequirements, annotation: draft.annotation, reviewAssetIds: reviewAssets.map((asset) => asset.id) }, evidence: [{ type: "submission", id: row.id, version: row.latestVersion, excerpt: text(row.textContent, "学生未填写文字内容").slice(0, 300), attachmentIds: attachments.map((asset) => asset.id) }, ...(aiDraft ? [{ type: "ai_review_draft", confidence: aiDraft.confidence, evidence: aiDraft.evidence, uncertainty: aiDraft.uncertainty, model: aiDraft.model }] : [])] }) }); setDraft({ outcome: "completed", score: "", reviewTags: [], teacherNote: "", revisionRequirements: "", annotation: "" }); setReviewAssets([]); setAiDraft(null); onCreated("批改结果已提交到待确认中心；当前尚未向学生或家长回传。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "待确认项创建失败"); }
    finally { setBusy(false); }
  };
  const tagOptions = [...new Set([...v2ReviewTagOptions, ...draft.reviewTags])];
  return <article><header><div><b>{text(row.studentName)}</b><small>{statusNames[text(row.status)] || text(row.status)}</small></div><span>第 {number(row.latestVersion)} 版</span></header><p>{text(row.textContent, "本次提交仅包含附件或暂无文字内容")}</p>{attachments.length > 0 && <div className="v2-submission-assets">{attachments.map((asset) => text(asset.mimeType, "").startsWith("audio/") ? <audio key={String(asset.id)} controls preload="none" src={text(asset.url)} aria-label={text(asset.name)}/> : <a key={String(asset.id)} href={text(asset.url)} target="_blank" rel="noreferrer">{text(asset.name)}</a>)}</div>}<button type="button" className="v2-ai-review-button" disabled={busy || aiBusy} onClick={() => void generateAiReview()}>{aiBusy ? "✦ AI 正在核对证据…" : "✦ AI 生成批改建议"}</button>{aiDraft && <div className="v2-ai-review-result"><b>AI 草稿 · 置信度 {Math.round(number(aiDraft.confidence) * 100)}%</b><p>{text(aiDraft.summary)}</p><small>{text(aiDraft.scoreBasis, "未建议分数")} · 模型 {text(aiDraft.model)}</small>{Array.isArray(aiDraft.uncertainty) && aiDraft.uncertainty.length > 0 && <em>需教师核对：{aiDraft.uncertainty.map(String).join("；")}</em>}</div>}<form className="v2-form" onSubmit={createApproval}><div className="v2-form-pair"><label>处理结果<select value={draft.outcome} onChange={(event) => setDraft((current) => ({ ...current, outcome: event.target.value }))}><option value="completed">完成</option><option value="excellent">优秀</option><option value="revision">要求订正</option><option value="incomplete">未完成</option></select></label><label>分数<input value={draft.score} onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))} type="number" min="0" step="0.5"/></label></div><fieldset className="v2-review-tags"><legend>批改标签</legend>{tagOptions.map((tag) => <label key={tag}><input type="checkbox" checked={draft.reviewTags.includes(tag)} onChange={(event) => setDraft((current) => ({ ...current, reviewTags: event.target.checked ? [...current.reviewTags, tag] : current.reviewTags.filter((item) => item !== tag) }))}/>{tag}</label>)}</fieldset><label>教师评语<textarea value={draft.teacherNote} onChange={(event) => setDraft((current) => ({ ...current, teacherNote: event.target.value }))} rows={3}/></label><label>订正要求<textarea value={draft.revisionRequirements} onChange={(event) => setDraft((current) => ({ ...current, revisionRequirements: event.target.value }))} rows={2}/></label><label>定位批注<textarea value={draft.annotation} onChange={(event) => setDraft((current) => ({ ...current, annotation: event.target.value }))} rows={2} placeholder="指出具体段落、图片或答题步骤的问题"/></label><label className="v2-file-picker">语音或批改附件<input type="file" multiple accept="audio/*,image/*,.pdf" onChange={(event) => void uploadReviewAssets(event.target.files)}/><small>{reviewAssets.length ? reviewAssets.map((asset) => asset.name).join("、") : "可上传语音讲解、批注图或 PDF"}</small></label>{error && <small className="v2-form-error">{error}</small>}<div className="v2-review-actions"><button type="button" className="v2-secondary-on-light" disabled={busy || aiBusy} onClick={() => void saveReviewDraft()}>保存批改草稿</button><button className="v2-primary" disabled={busy || aiBusy}>{busy ? "提交中…" : "提交确认并回传审批"}</button></div></form></article>;
}

function LearningWorkspace({ data, query, submit, creating, view, initialLessonId, initialStudentId, initialStatus, initialType, initialNew, initialAi }: { data: WorkspaceData; query: string; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean; view: "overview" | "feedback" | "analytics" | "reflections"; initialLessonId?: string; initialStudentId?: string; initialStatus?: string; initialType?: string; initialNew?: boolean; initialAi?: boolean }) {
  return <><nav className="v2-learning-tabs" aria-label="学情与反馈视图"><Link className={view === "overview" ? "active" : ""} href="/v2/modules/learning?view=overview">学情概览</Link><Link className={view === "feedback" ? "active" : ""} href="/v2/modules/learning?view=feedback">课程反馈</Link><Link className={view === "reflections" ? "active" : ""} href="/v2/modules/learning?view=reflections">教学反思</Link><Link className={view === "analytics" ? "active" : ""} href="/v2/modules/learning?view=analytics">证据数据中心</Link></nav>{view === "analytics" ? <LearningAnalytics/> : view === "reflections" ? <ReflectionWorkspace/> : view === "feedback" ? <FeedbackWorkspace initialLessonId={initialLessonId} initialStudentId={initialStudentId} initialStatus={initialStatus} initialType={initialType} initialNew={initialNew} initialAi={initialAi}/> : <LearningOverview data={data} query={query} submit={submit} creating={creating}/>}</>;
}

type AnalyticsRange = "week" | "month" | "term";

function LearningAnalytics() {
  const [draftRange, setDraftRange] = useState<AnalyticsRange>("week");
  const [appliedRange, setAppliedRange] = useState<AnalyticsRange>("week");
  const [analytics, setAnalytics] = useState<Row | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "permission" | "error">("loading");
  const loadRequest = useRef<AbortController | null>(null);

  const loadAnalytics = useCallback(async (range: AnalyticsRange) => {
    loadRequest.current?.abort();
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 15_000);
    loadRequest.current = controller;
    setAnalytics(null); setState("loading");
    try {
      const result = await requestJson(`/api/v2/analytics?range=${range}`, { signal: controller.signal, cache: "no-store" });
      const teaching = (result.teaching || {}) as Row, classroom = (result.classroom || {}) as Row, questionBank = (result.questionBank || {}) as Row, growth = (result.growth || {}) as Row;
      const hasEvidence = number(teaching.lessons) > 0 || number(classroom.assessmentCount) > 0 || number(questionBank.total) > 0 || number(growth.reflections) > 0 || (Array.isArray(result.studentTrend) && result.studentTrend.length > 0) || (Array.isArray(result.homeworkTrend) && result.homeworkTrend.length > 0);
      setAnalytics(result); setState(hasEvidence ? "ready" : "empty");
    } catch (caught) {
      const status = (caught as Error & { status?: number }).status;
      setState(status === 401 || status === 403 ? "permission" : "error");
    } finally { window.clearTimeout(timeout); if (loadRequest.current === controller) loadRequest.current = null; }
  }, []);

  useEffect(() => { void loadAnalytics(appliedRange); return () => loadRequest.current?.abort(); }, [appliedRange, loadAnalytics]);

  const teaching = (analytics?.teaching || {}) as Row, classroom = (analytics?.classroom || {}) as Row, questionBank = (analytics?.questionBank || {}) as Row, growth = (analytics?.growth || {}) as Row;
  const studentTrend = Array.isArray(analytics?.studentTrend) ? analytics.studentTrend as Row[] : [], homeworkTrend = Array.isArray(analytics?.homeworkTrend) ? analytics.homeworkTrend as Row[] : [];
  const difficulty = Array.isArray(questionBank.difficulty) ? questionBank.difficulty as Row[] : [], frequent = Array.isArray(questionBank.frequent) ? questionBank.frequent as Row[] : [];
  const repeatedProblems = Array.isArray(growth.repeatedProblems) ? growth.repeatedProblems as Row[] : [], knowledgeMastery = Array.isArray(classroom.knowledgeMastery) ? classroom.knowledgeMastery as Row[] : [];
  const rangeLabel = appliedRange === "week" ? "近 7 天" : appliedRange === "month" ? "近 30 天" : "近 180 天（学期）";
  const rate = (value: unknown) => value == null ? "数据不足" : `${number(value)}%`;
  const average = (value: unknown) => value == null ? "数据不足" : number(value).toFixed(1);

  return <div className="v2-analytics">
    <section className="v2-card v2-analytics-filter"><header className="v2-card-head"><div><h2>证据化教学观察</h2><p>只汇总当前工作室的真实记录，不展示学生姓名、联系方式或财务明细</p></div><Status value={rangeLabel}/></header><form onSubmit={(event) => { event.preventDefault(); setAppliedRange(draftRange); }}><label>统计范围<select value={draftRange} onChange={(event) => setDraftRange(event.target.value as AnalyticsRange)}><option value="week">周（7 天）</option><option value="month">月（30 天）</option><option value="term">学期（180 天）</option></select></label><button className="v2-primary">应用筛选</button><button type="button" className="v2-secondary-on-light" onClick={() => { setDraftRange("week"); setAppliedRange("week"); }}>重置筛选</button></form></section>
    {state === "loading" && <AnalyticsState title="正在读取数据中心" detail="统计完成前不展示旧结论或推测值。"/>}
    {state === "empty" && <AnalyticsState title="当前范围数据不足" detail="没有足够的课时、学习、题库、作业或反思记录；系统不会用 0 制造结论。" retry={() => void loadAnalytics(appliedRange)}/>}
    {state === "permission" && <AnalyticsState title="暂无权限查看数据中心" detail="当前账号没有读取聚合学情的权限，页面不会泄露学生或财务明细。" retry={() => void loadAnalytics(appliedRange)} tone="error"/>}
    {state === "error" && <AnalyticsState title="数据中心暂时不可用" detail="网络或服务器未完成统计，旧结论已清空，请重新读取。" retry={() => void loadAnalytics(appliedRange)} tone="error"/>}
    {state === "ready" && analytics && <>
      <section className="v2-card"><AnalyticsHeader index="一" title="教学效率" detail="课时、备课、完成和反馈均按已应用统计范围计算。"/><div className="v2-analytics-metrics"><EvidenceMetric label="课时记录" value={number(teaching.lessons)} range={rangeLabel} source="lessons.date / lessons.id" definition="所选范围内真实课时数量，不补齐无记录日期。"/><EvidenceMetric label="备课完成率" value={rate(teaching.prepRate)} range={rangeLabel} source="lessons.teaching_goals / key_points" definition="教学目标与重点均填写的课时数 ÷ 全部课时。"/><EvidenceMetric label="课时完成率" value={rate(teaching.completedRate)} range={rangeLabel} source="lessons.status" definition="已完成课时数 ÷ 所选范围全部课时。"/><EvidenceMetric label="反馈及时率" value={rate(teaching.feedbackRate)} range={rangeLabel} source="feedback.confirmed_at / lessons.date" definition="课后 48 小时内确认反馈数 ÷ 反馈记录总数。"/></div></section>
      <div className="v2-analytics-columns"><section className="v2-card"><AnalyticsHeader index="二" title="学生学习" detail="只展示聚合学习证据，不展开学生身份。"/><div className="v2-analytics-metrics"><EvidenceMetric label="出勤率" value={rate(classroom.attendanceRate)} range={rangeLabel} source="attendance.status" definition="出勤记录中 present 数量 ÷ 全部出勤记录。"/><EvidenceMetric label="作业完成率" value={rate(classroom.homeworkRate)} range={rangeLabel} source="assignment_submissions.status" definition="完成提交数 ÷ 全部作业提交记录。"/><EvidenceMetric label="测验平均分" value={average(classroom.assessmentAverage)} range={rangeLabel} source="assessment_results.score" definition="仅对已有分数的测验结果取算术平均。"/><EvidenceMetric label="有效测验记录" value={number(classroom.assessmentCount)} range={rangeLabel} source="COUNT(assessment_results.score)" definition="只计算 score 非空的结果。"/></div><AnalyticsTrend title="参与与理解" rows={studentTrend} values={["participation", "understanding"]} labels={["参与度", "理解度"]}/></section>
      <section className="v2-card"><AnalyticsHeader index="三" title="题库覆盖" detail="只统计已转正题目，未校对题目不混入。"/><div className="v2-analytics-metrics"><EvidenceMetric label="正式题目" value={number(questionBank.total)} range="当前正式题库" source="questions.status='active'" definition="状态为 active 的正式题目数。"/><EvidenceMetric label="知识点覆盖率" value={rate(questionBank.coverageRate)} range="当前正式题库" source="questions.knowledge_points" definition="已标知识点题目数 ÷ 正式题目总数。"/></div><AnalyticsRows title="难度分布" rows={difficulty} labelKey="difficulty" valueKey="count" suffix="题"/><AnalyticsRows title="常用题目" rows={frequent} labelKey="stem" valueKey="useCount" suffix="次使用"/></section></div>
      <section className="v2-card"><AnalyticsHeader index="四" title="作业趋势" detail="逐日列出真实提交；至少两个日期才称为趋势。"/><AnalyticsTrend title="完成记录" rows={homeworkTrend} values={["completed", "total"]} labels={["已完成", "总提交"]}/></section>
      <section className="v2-card"><AnalyticsHeader index="五" title="教师成长" detail="反思、行动和策略都来自私密记录。"/><div className="v2-analytics-metrics"><EvidenceMetric label="反思数量" value={number(growth.reflections)} range={rangeLabel} source="reflections.date" definition="所选范围内的私密教学反思数。"/><EvidenceMetric label="改进动作完成率" value={rate(growth.actionRate)} range={rangeLabel} source="reflections.action_completed" definition="已完成行动的反思数 ÷ 全部反思数。"/><EvidenceMetric label="沉淀教学策略" value={number(growth.strategies)} range={rangeLabel} source="reflections.is_strategy" definition="已标记为可复用策略的反思数。"/><EvidenceMetric label="重复问题记录" value={repeatedProblems.length} range={rangeLabel} source="reflections.difficulties" definition="只统计相同且出现次数大于 1 的困难。"/></div><div className="v2-analytics-columns"><AnalyticsRows title="重复问题" rows={repeatedProblems} labelKey="difficulties" valueKey="count" suffix="次"/><AnalyticsRows title="知识掌握证据" rows={knowledgeMastery} labelKey="mastery" valueKey="count" suffix="条"/></div></section>
    </>}
  </div>;
}

function AnalyticsHeader({ index, title, detail }: { index: string; title: string; detail: string }) { return <header className="v2-card-head"><div><p className="v2-eyebrow">模块{index} · 真实数据</p><h2>{title}</h2><p>{detail}</p></div></header>; }
function EvidenceMetric({ label, value, range, source, definition }: { label: string; value: string | number; range: string; source: string; definition: string }) { return <article><span>{label}</span><b>{value}</b><small><strong>统计范围：</strong>{range}<br/><strong>数据来源：</strong>{source}<br/>{definition} 分母为 0 时显示数据不足。</small></article>; }
function AnalyticsState({ title, detail, retry, tone }: { title: string; detail: string; retry?: () => void; tone?: "error" }) { return <section className={`v2-card v2-analytics-state ${tone || ""}`} role={tone ? "alert" : "status"}><h2>{title}</h2><p>{detail}</p>{retry && <button className="v2-secondary-on-light" onClick={retry}>重新读取</button>}</section>; }
function AnalyticsTrend({ title, rows, values, labels }: { title: string; rows: Row[]; values: string[]; labels: string[] }) { return <div className="v2-analytics-list"><h3>{title}</h3>{rows.length < 2 && <p>数据不足：至少两个日期才能判断变化。</p>}<ol aria-label={`${title}趋势数据`}>{rows.map((row, index) => <li key={`${text(row.date)}-${index}`}><time>{text(row.date)}</time>{values.map((key, valueIndex) => <span key={key}>{labels[valueIndex]} <b>{row[key] == null ? "数据不足" : number(row[key])}</b></span>)}</li>)}</ol></div>; }
function AnalyticsRows({ title, rows, labelKey, valueKey, suffix }: { title: string; rows: Row[]; labelKey: string; valueKey: string; suffix: string }) { return <div className="v2-analytics-list"><h3>{title}</h3>{!rows.length ? <p>数据不足：当前范围没有真实记录。</p> : <ul>{rows.map((row, index) => <li key={`${text(row[labelKey])}-${index}`}><span>{text(row[labelKey], "未填写")}</span><b>{number(row[valueKey])} {suffix}</b></li>)}</ul>}</div>; }

const feedbackExcluded = ["监护人联系方式", "微信标识", "附件原件与文件地址", "登录、会话和密钥数据"];
const feedbackBlank = (): Row => ({ type: "lesson", audience: "private", lengthMode: "short", lessonId: "", studentId: "", classId: "", tone: "温和鼓励", opening: "", closing: "", styleRules: "", previousHomework: "", classPerformance: "", weakPoints: "", dueAt: "", customInput: "", learningContent: "", highlights: "", consolidate: "", homeworkRequirements: "", parentAdvice: "", nextFocus: "", reflectionOutline: "", periodStart: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), periodEnd: new Date().toISOString().slice(0, 10), periodSummary: "", progress: "", problems: "", goals: "", suggestions: "", content: "", shortContent: "", standardContent: "", aiGenerated: false, aiDraftId: null, aiReviewed: false, evidenceRefs: [] });
function stageFeedbackText(form: Row) { const body = [`阶段总结：${text(form.periodSummary, "待补充")}`, `本阶段进步：${text(form.progress, "待补充")}`, `需要解决的问题：${text(form.problems, "待补充")}`, `下一阶段目标：${text(form.goals, "待补充")}`, `具体建议：${text(form.suggestions, "待补充")}`].join("\n\n"); return text(form.tone) === "温和鼓励" ? `您好，以下是本次学习反馈。\n\n${body}\n\n我们会继续关注每一步进展，也感谢您的配合。` : text(form.tone) === "重点提醒" ? `【重点学习提醒】\n\n${body}\n\n请优先落实上述巩固任务，并在下次课前完成检查。` : body; }

function FeedbackWorkspace({ initialLessonId, initialStudentId, initialStatus, initialType, initialNew = false, initialAi = false }: { initialLessonId?: string; initialStudentId?: string; initialStatus?: string; initialType?: string; initialNew?: boolean; initialAi?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]), [lessons, setLessons] = useState<Row[]>([]), [students, setStudents] = useState<Row[]>([]), [templates, setTemplates] = useState<Row[]>([]), [pendingDrafts, setPendingDrafts] = useState<Row[]>([]);
  const [typeFilter, setTypeFilter] = useState(initialNew ? "" : initialType || ""), [statusFilter, setStatusFilter] = useState(initialStatus || ""), [lessonFilter, setLessonFilter] = useState(initialLessonId || ""), [studentFilter, setStudentFilter] = useState(initialStudentId || "");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false), [editingId, setEditingId] = useState(0), [form, setForm] = useState<Row>(feedbackBlank), [baseline, setBaseline] = useState("");
  const [aiDraft, setAiDraft] = useState<Row | null>(null), [aiMeta, setAiMeta] = useState<Row | null>(null), [aiPreviewKey, setAiPreviewKey] = useState("");
  const [templateName, setTemplateName] = useState(""), [printRow, setPrintRow] = useState<Row | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null), previousFocusRef = useRef<HTMLElement | null>(null), busyRef = useRef(false), dirtyRef = useRef(false), deepLinkHandledRef = useRef(false);
  const dirty = editorOpen && JSON.stringify(form) !== baseline;
  const previewKey = [text(form.lessonId, ""), text(form.studentId, ""), text(form.audience, ""), text(form.tone, "")].join(":");

  const loadFeedback = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ type: typeFilter, status: statusFilter, lessonId: lessonFilter, studentId: studentFilter }), lessonFrom = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
      const [feedbackResult, lessonResult, studentResult, templateResult, draftResult] = await Promise.all([requestJson(`/api/v2/feedback?${params}`, { signal }), requestJson(`/api/v2/lessons?from=${lessonFrom}`, { signal }), requestJson("/api/v2/students?status=active", { signal }), requestJson("/api/v2/feedback/templates", { signal }), requestJson("/api/v2/ai/feedback-drafts", { signal, cache: "no-store" })]);
      setRows((feedbackResult.feedback || []) as Row[]); setLessons((lessonResult.lessons || []) as Row[]); setStudents((studentResult.students || []) as Row[]); setTemplates((templateResult.templates || []) as Row[]); setPendingDrafts((draftResult.drafts || []) as Row[]);
    } catch (caught) { if (!signal?.aborted) { setRows([]); setError(caught instanceof Error ? caught.message : "反馈中心读取失败"); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [lessonFilter, statusFilter, studentFilter, typeFilter]);
  useEffect(() => { const controller = new AbortController(); void loadFeedback(controller.signal); return () => controller.abort(); }, [loadFeedback]);
  useEffect(() => { busyRef.current = busy; dirtyRef.current = dirty; }, [busy, dirty]);

  const openEditor = useCallback((source?: Row, id = 0) => { const next = { ...feedbackBlank(), ...(source || {}) }; setForm(next); setBaseline(JSON.stringify(next)); setEditingId(id); setAiDraft(null); setAiMeta(null); setAiPreviewKey(""); setError(""); previousFocusRef.current = document.activeElement as HTMLElement; setEditorOpen(true); }, []);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    if (initialLessonId) {
      const lesson = lessons.find((row) => String(row.id) === initialLessonId);
      if (!lesson) return;
      deepLinkHandledRef.current = true;
      openEditor({ lessonId: initialLessonId, studentId: initialStudentId || "", classId: text(lesson.classId, "") });
      setNotice(initialAi ? "已带入本节课；请先使用真实记录并核对发送字段，再生成 AI 草稿。" : "已从课时详情带入本节课。正式发送仍需确认。");
      return;
    }
    if (!initialNew || loading) return;
    deepLinkHandledRef.current = true;
    openEditor({ type: initialType === "stage" ? "stage" : "lesson", studentId: initialStudentId || "" });
    setNotice(initialType === "stage" ? "已进入该学生的阶段反馈草稿。请先选择班级或核对学生证据。" : "已建立未发布反馈草稿。");
  }, [initialAi, initialLessonId, initialNew, initialStudentId, initialType, lessons, loading, openEditor]);
  const closeEditor = () => { setEditorOpen(false); setEditingId(0); setForm(feedbackBlank()); setAiDraft(null); setAiMeta(null); setAiPreviewKey(""); previousFocusRef.current?.focus(); };
  const dismissEditor = () => { if (busyRef.current) return; if (dirtyRef.current && !window.confirm("当前反馈尚未保存，确定放弃这些修改吗？")) return; closeEditor(); };
  useEffect(() => {
    if (!editorOpen) return; const dialog = dialogRef.current; dialog?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); if (dirtyRef.current && !window.confirm("当前反馈尚未保存，确定放弃这些修改吗？")) return; setEditorOpen(false); setEditingId(0); previousFocusRef.current?.focus(); return; } if (event.key !== "Tab" || !dialog) return; const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])")]; if (!focusable.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen]);
  useEffect(() => { if (!editorOpen) return; const protect = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect); }, [editorOpen]);

  const previewText = () => { const lesson = lessons.find((row) => number(row.id) === number(form.lessonId)), student = students.find((row) => number(row.id) === number(form.studentId)), source = { ...form, studentName: student?.name, lessonDate: lesson?.date, startTime: lesson?.startTime, endTime: lesson?.endTime }; return text(form.type) === "stage" ? stageFeedbackText(form) : generateFeedback(source, text(form.lengthMode) === "standard" ? "standard" : "short", text(form.audience) === "group" ? "group" : "private"); };
  const payloadFor = (status: string) => { const lesson = lessons.find((row) => number(row.id) === number(form.lessonId)), student = students.find((row) => number(row.id) === number(form.studentId)), source = { ...form, studentName: student?.name, lessonDate: lesson?.date, startTime: lesson?.startTime, endTime: lesson?.endTime }, stage = stageFeedbackText(form), shortContent = Boolean(form.aiGenerated) && text(form.shortContent, "") ? text(form.shortContent, "") : text(form.type) === "stage" ? stage : generateFeedback(source, "short", text(form.audience) === "group" ? "group" : "private"), standardContent = Boolean(form.aiGenerated) && text(form.standardContent, "") ? text(form.standardContent, "") : text(form.type) === "stage" ? stage : generateFeedback(source, "standard", text(form.audience) === "group" ? "group" : "private"); return { ...form, lessonId: text(form.lessonId, "") ? number(form.lessonId) : null, studentId: text(form.studentId, "") ? number(form.studentId) : null, classId: text(form.classId, "") ? number(form.classId) : null, shortContent, standardContent, content: text(form.content, "") || (text(form.lengthMode) === "standard" ? standardContent : shortContent), status, aiReviewed: Boolean(form.aiReviewed) }; };
  const save = async (status: "draft" | "confirmed") => { if (busy) return; if (Boolean(form.aiGenerated) && !Boolean(form.aiReviewed)) { setError("请先逐项核对 AI 草稿并勾选教师确认。"); return; } setBusy(true); setError(""); try { await requestJson(editingId ? `/api/v2/feedback/${editingId}` : "/api/v2/feedback", { method: editingId ? "PUT" : "POST", body: JSON.stringify(payloadFor(status)) }); closeEditor(); setNotice(status === "confirmed" ? "反馈已确认；正式发送仍需进入待确认中心。" : "反馈草稿已私密保存。"); await loadFeedback(); } catch (caught) { setError(caught instanceof Error ? caught.message : "反馈保存失败"); } finally { setBusy(false); } };

  const applyLessonRecords = () => { const lesson = lessons.find((row) => number(row.id) === number(form.lessonId)); if (!lesson) { setError("请先关联一节真实课时。"); return; } setForm((current) => ({ ...current, classId: text(lesson.classId, ""), learningContent: text(current.learningContent, "") || text(lesson.actualContent, text(lesson.topic, "")), homeworkRequirements: text(current.homeworkRequirements, "") || text(lesson.homework, ""), nextFocus: text(current.nextFocus, "") || text(lesson.nextPlan, ""), evidenceRefs: Array.isArray(current.evidenceRefs) && current.evidenceRefs.length ? current.evidenceRefs : [{ sourceType: "lesson", sourceId: lesson.id, label: `${text(lesson.date)} ${text(lesson.topic, text(lesson.courseName))}`, excerpt: text(lesson.actualContent, "").slice(0, 500), sourceDate: lesson.date }] })); setNotice("已带入真实课时记录，没有补写教材观点或学生结论。"); };
  const buildSummary = async () => { if (busy) return; if (!text(form.classId, "") && !text(form.studentId, "")) { setError("阶段汇总前请先选择班级或学生。"); return; } setBusy(true); setError(""); try { const params = new URLSearchParams({ classId: text(form.classId, ""), studentId: text(form.studentId, ""), start: text(form.periodStart, ""), end: text(form.periodEnd, "") }), result = await requestJson(`/api/v2/feedback/summary?${params}`), draft = (result.draft || {}) as Row; setForm((current) => ({ ...current, ...draft })); setNotice("已汇总真实课时、出勤、作业与测验；结论仍需教师核对。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "阶段汇总失败"); } finally { setBusy(false); } };
  const preflightAi = async () => { if (busy || !text(form.lessonId, "")) return; setBusy(true); setError(""); try { const result = await requestJson("/api/v2/ai/feedback-drafts", { method: "POST", body: JSON.stringify({ lessonId: number(form.lessonId), studentId: number(form.studentId), audience: form.audience, tone: form.tone, previousHomework: form.previousHomework, classPerformance: form.classPerformance, weakPoints: form.weakPoints, customInput: form.customInput, preview: true }) }); setAiMeta(result); setAiPreviewKey(previewKey); setNotice("已核对本次实际发送字段；尚未调用外部模型。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "发送字段核对失败"); } finally { setBusy(false); } };
  const generateAi = async () => { if (busy || aiPreviewKey !== previewKey) { setError("课时、学生、语气或发送对象已变化，请重新核对发送字段。"); return; } setBusy(true); setError(""); try { const result = await requestJson("/api/v2/ai/feedback-drafts", { method: "POST", body: JSON.stringify({ lessonId: number(form.lessonId), studentId: number(form.studentId), audience: form.audience, tone: form.tone, previousHomework: form.previousHomework, classPerformance: form.classPerformance, weakPoints: form.weakPoints, customInput: form.customInput }) }); setAiDraft((result.draft || {}) as Row); setAiMeta(result); setNotice("AI 仅生成可恢复的未发布草稿；尚未写入正式反馈。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "AI 反馈草稿生成失败"); } finally { setBusy(false); } };
  const adoptAi = () => { if (!aiDraft) return; const next = { ...form }; for (const key of ["content", "shortContent", "standardContent", "learningContent", "highlights", "consolidate", "homeworkRequirements", "parentAdvice", "nextFocus", "reflectionOutline"]) if (!text(next[key], "") && text(aiDraft[key], "")) next[key] = aiDraft[key]; next.aiDraftId = aiDraft.aiDraftId; next.aiGenerated = true; next.aiReviewed = false; setForm(next); setNotice("AI 草稿已补入空白字段；已有教师文字保持不变。"); };
  const resumeDraft = (row: Row) => { const draft = (row.draft || {}) as Row; openEditor({ ...feedbackBlank(), ...draft, lessonId: text(row.lessonId, ""), studentId: text(row.studentId, ""), aiDraftId: row.id, aiGenerated: true, aiReviewed: false }); setAiMeta({ sentFields: row.sentFields, excludedFields: feedbackExcluded }); };
  const discardDraft = async (id: number) => { if (busy || !window.confirm("确认放弃这份 AI 草稿？正式反馈不会被修改。")) return; setBusy(true); try { await requestJson("/api/v2/ai/feedback-drafts", { method: "DELETE", body: JSON.stringify({ id }) }); setPendingDrafts((current) => current.filter((row) => number(row.id) !== id)); setNotice("AI 草稿已放弃。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "AI 草稿放弃失败"); } finally { setBusy(false); } };
  const requestSend = async (row: Row) => { if (busy) return; setBusy(true); setError(""); try { await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "feedback.send", entityType: "feedback", entityId: String(row.id), title: "发送已确认反馈", summary: text(row.content).slice(0, 500), payload: { id: number(row.id), audience: row.audience }, evidence: Array.isArray(row.evidence) ? row.evidence : [] }) }); setNotice("反馈发送已进入待确认中心，当前尚未发送给学生或家长。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "发送确认创建失败"); } finally { setBusy(false); } };
  const copy = async (row: Row, mode: "short" | "standard") => { try { await navigator.clipboard.writeText(text(mode === "short" ? row.shortContent : row.standardContent, text(row.content))); await requestJson(`/api/v2/feedback/${row.id}/copied`, { method: "POST" }); setNotice(`已复制${mode === "short" ? "简短" : "标准"}版反馈。`); } catch { setError("复制失败，请确认浏览器已允许剪贴板访问。"); } };
  const remove = async (row: Row) => { if (busy || !window.confirm("确认永久删除这条反馈？删除后不可恢复。")) return; setBusy(true); try { await requestJson(`/api/v2/feedback/${row.id}`, { method: "DELETE" }); setRows((current) => current.filter((item) => item.id !== row.id)); setNotice("反馈已永久删除。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "反馈删除失败"); } finally { setBusy(false); } };
  const saveTemplate = async () => { if (busy || !templateName.trim()) { setError("请先填写话术模板名称。"); return; } setBusy(true); try { await requestJson("/api/v2/feedback/templates", { method: "POST", body: JSON.stringify({ name: templateName.trim(), audience: form.audience, tone: form.tone, opening: form.opening, closing: form.closing, styleRules: form.styleRules, exampleText: previewText() }) }); setTemplateName(""); setNotice("当前话术风格已保存。"); await loadFeedback(); } catch (caught) { setError(caught instanceof Error ? caught.message : "话术模板保存失败"); } finally { setBusy(false); } };

  const metrics = { total: rows.length, draft: rows.filter((row) => text(row.status) === "draft").length, confirmed: rows.filter((row) => text(row.status) === "confirmed").length, sent: rows.filter((row) => Boolean(row.sentAt)).length };
  return <div className="v2-feedback">
    <MetricStrip items={[{ label: "当前反馈", value: metrics.total, detail: "当前筛选范围" }, { label: "待确认草稿", value: metrics.draft, detail: "仅教师可见" }, { label: "已确认", value: metrics.confirmed, detail: "可提交发送确认" }, { label: "已发送", value: metrics.sent, detail: "审批后同步" }]}/>{notice && <p className="v2-alert" role="status">{notice}</p>}{error && <p className="v2-alert v2-error" role="alert">{error}</p>}
    <section className="v2-card"><header className="v2-card-head"><div><h2>课程与阶段反馈</h2><p>只使用真实课时和学习证据；正式发送统一进入待确认中心</p></div><button className="v2-primary" disabled={busy} onClick={() => openEditor()}>＋ 新建反馈</button></header><div className="v2-feedback-filters"><label>反馈类型<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">全部反馈</option><option value="lesson">单节课反馈</option><option value="stage">阶段反馈</option></select></label><label>反馈状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="draft">草稿</option><option value="confirmed">已确认</option></select></label><label>课时<select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value)}><option value="">全部课时</option>{lessons.slice(0, 100).map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.date)} · {text(row.topic, text(row.courseName))}</option>)}</select></label><label>学生<select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}><option value="">全部学生</option>{students.slice(0, 200).map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label></div></section>
    {pendingDrafts.length > 0 && <section className="v2-card"><header className="v2-card-head"><div><h2>待确认 AI 反馈草稿</h2><p>可恢复或明确放弃；尚未进入正式反馈</p></div><Status value={`${pendingDrafts.length} 条待处理`} tone="warning"/></header><div className="v2-feedback-drafts">{pendingDrafts.map((row) => <article key={String(row.id)}><div><b>{text(row.date)} · {text(row.studentName, text(row.courseName, "班级草稿"))}</b><small>{text(row.createdAt)}</small></div><button onClick={() => resumeDraft(row)}>继续核对</button><button className="danger" onClick={() => void discardDraft(number(row.id))}>放弃</button></article>)}</div></section>}
    <section className="v2-card"><div className={`v2-feedback-list ${loading ? "v2-loading" : ""}`}>{rows.map((row) => <article key={String(row.id)}><header><div><span>{text(row.type) === "stage" ? "阶段反馈" : text(row.audience) === "group" ? "家长群版" : "微信私聊版"}</span><Status value={row.sentAt ? "已发送" : row.copiedAt ? "已复制" : text(row.status) === "confirmed" ? "已确认" : "草稿"}/></div><small>{text(row.updatedAt)}</small></header><h3>{row.studentId ? text(students.find((student) => number(student.id) === number(row.studentId))?.name, "学生反馈") : row.classId ? `班级 #${row.classId}` : "通用反馈"}</h3><p>{text(row.content).slice(0, 180)}</p><div className="v2-evidence-chips"><span><b>证据来源</b>{Array.isArray(row.evidence) ? row.evidence.length : 0} 条</span><span><b>长度</b>{text(row.lengthMode) === "standard" ? "标准版" : "简短版"}</span><span><b>语气</b>{text(row.tone)}</span></div><footer><button onClick={() => openEditor(row, number(row.id))}>编辑</button><button onClick={() => openEditor({ ...feedbackBlank(), ...row, lessonId: "", studentId: "", classId: "", aiDraftId: null, aiGenerated: false, status: "draft", evidenceRefs: [] })}>用作新模板</button>{text(row.status) === "confirmed" && <><button onClick={() => void copy(row, "short")}>复制简短版</button><button onClick={() => void copy(row, "standard")}>复制标准版</button><button disabled={Boolean(row.sentAt)} onClick={() => void requestSend(row)}>{row.sentAt ? "已发送" : "提交发送确认"}</button><button onClick={() => { setPrintRow(row); window.setTimeout(() => window.print(), 50); }}>打印</button></>}<button className="danger" onClick={() => void remove(row)}>删除</button></footer></article>)}{!loading && !rows.length && <Empty title="没有匹配的反馈" detail="新建单节课或阶段反馈；系统不会填充虚构结论。"/>}</div></section>
    {printRow && <section className="v2-feedback-print"><h1>学习反馈</h1><p>{text(printRow.standardContent, text(printRow.content))}</p></section>}
    {editorOpen && <div className="v2-feedback-backdrop" role="presentation"><div className="v2-feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-editor-title" tabIndex={-1} ref={dialogRef}><header><div><p>创建 / 编辑 · 仅教师可见</p><h2 id="feedback-editor-title">{editingId ? "编辑反馈" : text(form.type) === "stage" ? "新建阶段反馈" : "新建单节课反馈"}</h2></div><button aria-label="关闭反馈编辑器" disabled={busy} onClick={dismissEditor}>×</button></header><div className="v2-feedback-editor-grid"><label>反馈类型<select value={text(form.type)} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="lesson">单节课反馈</option><option value="stage">阶段反馈</option></select></label><label>发送对象<select value={text(form.audience)} onChange={(event) => { setForm((current) => ({ ...current, audience: event.target.value })); setAiPreviewKey(""); }}><option value="private">微信私聊版</option><option value="group">家长群版</option></select></label><label>语气<select value={text(form.tone)} onChange={(event) => { setForm((current) => ({ ...current, tone: event.target.value })); setAiPreviewKey(""); }}><option>专业简洁</option><option>温和鼓励</option><option>重点提醒</option></select></label><label>长度<select value={text(form.lengthMode)} onChange={(event) => setForm((current) => ({ ...current, lengthMode: event.target.value }))}><option value="short">简短版</option><option value="standard">标准版</option></select></label><ClassPicker endpoint="/api/v2/classes/options" label="班级" value={text(form.classId, "")} onChange={(value) => setForm((current) => ({ ...current, classId: value }))} allowClear/><label>学生<select value={text(form.studentId, "")} onChange={(event) => { setForm((current) => ({ ...current, studentId: event.target.value })); setAiPreviewKey(""); }}><option value="">班级整体</option>{students.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label>{text(form.type) === "lesson" ? <><label className="wide">关联真实课时<select value={text(form.lessonId, "")} onChange={(event) => { const lesson = lessons.find((row) => String(row.id) === event.target.value); setForm((current) => ({ ...current, lessonId: event.target.value, classId: text(lesson?.classId, text(current.classId, "")) })); setAiPreviewKey(""); setAiDraft(null); }}><option value="">暂不关联</option>{lessons.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.date)} · {text(row.topic, text(row.courseName))}</option>)}</select></label><div className="wide v2-feedback-tools"><button onClick={applyLessonRecords}>使用单节课真实记录</button><button onClick={() => void preflightAi()} disabled={!text(form.lessonId, "")}>先核对发送字段</button><button onClick={() => void generateAi()} disabled={aiPreviewKey !== previewKey}>✦ 生成 AI 课后闭环草稿</button></div>{[["上次作业", "previousHomework"], ["课堂表现", "classPerformance"], ["薄弱点", "weakPoints"], ["学习内容", "learningContent"], ["表现亮点", "highlights"], ["需要巩固", "consolidate"], ["作业要求", "homeworkRequirements"], ["家长沟通稿", "parentAdvice"], ["下节重点", "nextFocus"], ["教学反思提纲", "reflectionOutline"]].map(([label, key]) => <label className="wide" key={key}>{label}<textarea rows={2} value={text(form[key], "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}/></label>)}<label>预计提交时间<input type="datetime-local" value={text(form.dueAt, "")} onChange={(event) => setForm((current) => ({ ...current, dueAt: event.target.value }))}/></label><label className="wide">简短补充<textarea rows={2} value={text(form.customInput, "")} onChange={(event) => { setForm((current) => ({ ...current, customInput: event.target.value })); setAiPreviewKey(""); }}/></label></> : <><label>阶段开始<input type="date" value={text(form.periodStart, "")} onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))}/></label><label>阶段结束<input type="date" value={text(form.periodEnd, "")} onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))}/></label><div className="wide v2-feedback-tools"><button onClick={() => void buildSummary()}>汇总真实课时、出勤、作业与测验</button><span>只生成草稿，不自动下结论</span></div>{[["阶段总结", "periodSummary"], ["本阶段进步", "progress"], ["需要解决的问题", "problems"], ["下一阶段目标", "goals"], ["具体建议", "suggestions"]].map(([label, key]) => <label className="wide" key={key}>{label}<textarea rows={3} value={text(form[key], "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}/></label>)}</>}<label>开场语<input value={text(form.opening, "")} onChange={(event) => setForm((current) => ({ ...current, opening: event.target.value }))}/></label><label>结束语<input value={text(form.closing, "")} onChange={(event) => setForm((current) => ({ ...current, closing: event.target.value }))}/></label><label className="wide">话术规则<input value={text(form.styleRules, "")} onChange={(event) => setForm((current) => ({ ...current, styleRules: event.target.value }))}/></label><div className="wide v2-feedback-template"><select value="" onChange={(event) => { const template = templates.find((row) => number(row.id) === number(event.target.value)); if (template) setForm((current) => ({ ...current, audience: template.audience, tone: template.tone, opening: template.opening, closing: template.closing, styleRules: template.styleRules })); }}><option value="">选择已保存话术</option>{templates.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select><input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="新模板名称"/><button onClick={() => void saveTemplate()}>保存当前话术风格</button></div></div>{aiMeta && <section className="v2-feedback-ai"><b>本次实际发送字段</b><p>{Array.isArray(aiMeta.sentFields) ? aiMeta.sentFields.join("、") : "尚未核对"}</p><b>永不发送</b><p>{Array.isArray(aiMeta.excludedFields) ? aiMeta.excludedFields.join("、") : feedbackExcluded.join("、")}</p>{aiDraft && <><p>AI 草稿尚未写入反馈，采用时只补空白字段。</p><button onClick={adoptAi}>采用 AI 草稿</button><button className="danger" onClick={() => setAiDraft(null)}>丢弃草稿</button></>}</section>}{Boolean(form.aiGenerated) && <label className="v2-feedback-review"><input type="checkbox" checked={Boolean(form.aiReviewed)} onChange={(event) => setForm((current) => ({ ...current, aiReviewed: event.target.checked }))}/>我已逐项核对 AI 生成的课堂小结、亮点、巩固、作业、下节计划、家长沟通稿和反思提纲</label>}<section className="v2-feedback-preview"><b>反馈文本预览</b><pre>{text(form.content, "") || previewText()}</pre><div className="v2-evidence-chips"><span><b>证据来源</b>{Array.isArray(form.evidenceRefs) ? form.evidenceRefs.length : 0} 条</span><span><b>状态</b>尚未发布</span></div></section><footer><button className="v2-secondary-on-light" disabled={busy} onClick={dismissEditor}>取消</button><button className="v2-secondary-on-light" disabled={busy} onClick={() => void save("draft")}>保存草稿</button><button className="v2-primary" disabled={busy} onClick={() => void save("confirmed")}>确认反馈</button></footer></div></div>}
  </div>;
}

const reflectionFields = ["problemType", "tags", "expectedVsActual", "effectivePractices", "difficulties", "studentEvidence", "nextAction", "reusableMaterial"] as const;
const newReflection = (): Row => ({ date: new Date().toISOString().slice(0, 10), lessonId: "", problemType: "", tags: "", expectedVsActual: "", effectivePractices: "", difficulties: "", studentEvidence: "", nextAction: "", actionCompleted: false, reusableMaterial: "", isStrategy: false });
const reflectionPayload = (row: Row, isStrategy = Boolean(row.isStrategy)) => ({ date: text(row.date, ""), lessonId: text(row.lessonId, "") ? number(row.lessonId) : null, problemType: text(row.problemType, ""), tags: text(row.tags, ""), expectedVsActual: text(row.expectedVsActual, ""), effectivePractices: text(row.effectivePractices, ""), difficulties: text(row.difficulties, ""), studentEvidence: text(row.studentEvidence, ""), nextAction: text(row.nextAction, ""), actionCompleted: Boolean(row.actionCompleted), reusableMaterial: text(row.reusableMaterial, ""), isStrategy });

function ReflectionWorkspace() {
  const [rows, setRows] = useState<Row[]>([]), [lessons, setLessons] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Row>({ q: "", tag: "", month: "", topic: "", problemType: "", classId: "" });
  const [appliedQuery, setAppliedQuery] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [selected, setSelected] = useState<Row | null>(null), [detailLoading, setDetailLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false), [editingId, setEditingId] = useState(0), [form, setForm] = useState<Row>(newReflection), [baseline, setBaseline] = useState("");
  const [aiDraft, setAiDraft] = useState<Row | null>(null), [aiMeta, setAiMeta] = useState<Row | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null), previousFocusRef = useRef<HTMLElement | null>(null);
  const formDirty = editorOpen && (JSON.stringify(form) !== baseline || Boolean(aiDraft));

  const loadReflections = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const lessonFrom = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
      const [reflectionResult, lessonResult] = await Promise.all([requestJson(`/api/v2/reflections${appliedQuery ? `?${appliedQuery}` : ""}`), requestJson(`/api/v2/lessons?from=${lessonFrom}`)]);
      setRows((reflectionResult.reflections || []) as Row[]); setLessons((lessonResult.lessons || []) as Row[]);
    } catch (caught) { setRows([]); setError(caught instanceof Error ? caught.message : "反思工作区读取失败"); }
    finally { setLoading(false); }
  }, [appliedQuery]);
  useEffect(() => { void loadReflections(); }, [loadReflections]);

  const calendarMonth = text(filters.month, new Date().toISOString().slice(0, 7));
  const calendar = useMemo(() => { const [year, month] = calendarMonth.split("-").map(Number), first = new Date(year, month - 1, 1), count = new Date(year, month, 0).getDate(); return { offset: (first.getDay() + 6) % 7, days: Array.from({ length: count }, (_, index) => `${calendarMonth}-${String(index + 1).padStart(2, "0")}`) }; }, [calendarMonth]);
  const strategies = rows.filter((row) => Boolean(row.isStrategy));

  const applyFilters = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const params = new URLSearchParams(); for (const key of ["q", "tag", "month", "topic", "problemType", "classId"]) { const value = text(filters[key], ""); if (value) params.set(key, value); } setAppliedQuery(params.toString()); };
  const openEditor = (row?: Row) => { const next = row ? { ...newReflection(), ...row, lessonId: text(row.lessonId, "") } : newReflection(); setForm(next); setBaseline(JSON.stringify(next)); setEditingId(number(row?.id)); setAiDraft(null); setAiMeta(null); setError(""); previousFocusRef.current = document.activeElement as HTMLElement; setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setEditingId(0); setAiDraft(null); setAiMeta(null); previousFocusRef.current?.focus(); };
  const dismissEditor = () => { if (formDirty && !window.confirm("当前反思尚未保存，确认放弃这些修改？")) return; closeEditor(); };

  useEffect(() => {
    if (!editorOpen) return;
    const dialog = dialogRef.current; dialog?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (formDirty && !window.confirm("当前反思尚未保存，确认放弃这些修改？")) return; setEditorOpen(false); setEditingId(0); setAiDraft(null); setAiMeta(null); previousFocusRef.current?.focus(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])")]; if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [editorOpen, formDirty]);
  useEffect(() => { if (!formDirty) return; const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect); }, [formDirty]);

  const save = async () => {
    if (busy) return; if (!text(form.date, "")) { setError("请先填写反思日期"); return; }
    setBusy(true); setError(""); setNotice("");
    try { await requestJson(editingId ? `/api/v2/reflections/${editingId}` : "/api/v2/reflections", { method: editingId ? "PUT" : "POST", body: JSON.stringify(reflectionPayload(form)) }); closeEditor(); setNotice("反思已私密保存，尚未公开或发送。"); await loadReflections(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "反思保存失败"); }
    finally { setBusy(false); }
  };
  const openDetail = async (row: Row) => { setSelected(row); setDetailLoading(true); setError(""); try { const result = await requestJson(`/api/v2/reflections/${row.id}`); setSelected((result.reflection || row) as Row); } catch (caught) { setError(caught instanceof Error ? caught.message : "反思详情读取失败"); } finally { setDetailLoading(false); } };
  const updateReflection = async (row: Row, updates: Row, message: string) => { if (busy) return; setBusy(true); setError(""); try { const result = await requestJson(`/api/v2/reflections/${row.id}`, { method: "PUT", body: JSON.stringify(reflectionPayload({ ...row, ...updates }, Boolean(updates.isStrategy ?? row.isStrategy))) }); const updated = (result.reflection || { ...row, ...updates }) as Row; setRows((current) => current.map((item) => item.id === row.id ? updated : item)); setSelected((current) => current?.id === row.id ? updated : current); setNotice(message); } catch (caught) { setError(caught instanceof Error ? caught.message : "反思更新失败"); } finally { setBusy(false); } };
  const remove = async (row: Row) => { if (busy || !window.confirm("确认永久删除这条私密反思？删除后不可恢复。")) return; setBusy(true); setError(""); try { await requestJson(`/api/v2/reflections/${row.id}`, { method: "DELETE" }); setRows((current) => current.filter((item) => item.id !== row.id)); if (selected?.id === row.id) setSelected(null); setNotice("反思已永久删除。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "反思删除失败"); } finally { setBusy(false); } };
  const promote = async (row: Row) => {
    if (busy) return; const evidence = [text(row.effectivePractices, ""), text(row.nextAction, ""), text(row.reusableMaterial, "")].filter(Boolean);
    if (!evidence.length) { setError("至少记录有效做法、改进动作或可复用素材后才能沉淀。"); return; }
    if (!window.confirm("教师明确选择：将这条真实反思沉淀为私有教学策略？")) return;
    setBusy(true); setError(""); let resourceId = 0;
    try { const created = await requestJson("/api/v2/resources", { method: "POST", body: JSON.stringify({ title: `教学策略 · ${text(row.date)} · ${text(row.lessonTopic, "课堂复盘")}`, type: "教学策略", tags: text(row.tags, ""), content: evidence.join("\n\n"), sourceRef: `reflection:${row.id}`, visibility: "private" }) }); resourceId = number((created.resource as Row | undefined)?.id); if (!resourceId) throw new Error("策略资源未成功建立"); const result = await requestJson(`/api/v2/reflections/${row.id}`, { method: "PUT", body: JSON.stringify(reflectionPayload(row, true)) }), updated = (result.reflection || { ...row, isStrategy: true }) as Row; setRows((current) => current.map((item) => item.id === row.id ? updated : item)); setSelected((current) => current?.id === row.id ? updated : current); setNotice("已沉淀为私有教学策略，可在资源中心继续编辑。"); }
    catch (caught) { if (resourceId) await requestJson(`/api/v2/resources/${resourceId}`, { method: "DELETE" }).catch(() => undefined); setError(caught instanceof Error ? caught.message : "策略沉淀失败，未完成资源已回收"); }
    finally { setBusy(false); }
  };
  const generateAiDraft = async () => { if (aiBusy) return; if (!text(form.lessonId, "")) { setError("请先关联一节真实课时，再生成 AI 反思草稿。"); return; } setAiBusy(true); setError(""); try { const result = await requestJson("/api/v2/ai/reflection-drafts", { method: "POST", body: JSON.stringify({ lessonId: number(form.lessonId) }) }); setAiDraft((result.draft || {}) as Row); setAiMeta({ sentFields: result.sentFields, excludedFields: result.excludedFields }); setNotice("AI 反思草稿已生成；草稿尚未保存、发布或覆盖教师文字。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "AI 反思草稿生成失败"); } finally { setAiBusy(false); } };
  const applyAiDraft = () => { if (!aiDraft) return; let count = 0; const next = { ...form }; for (const key of reflectionFields) if (!text(next[key], "") && text(aiDraft[key], "")) { next[key] = aiDraft[key]; count += 1; } setForm(next); setNotice(count ? `AI 草稿已补入 ${count} 个空白字段；已有教师文字保持不变。` : "没有空白字段可补入，教师文字未改变。"); };

  return <div className="v2-reflections">
    {notice && <p className="v2-alert" role="status">{notice}</p>}{error && <p className="v2-alert v2-error" role="alert">{error}</p>}
    <section className="v2-card"><header className="v2-card-head"><div><h2>私密教学反思</h2><p>把真实课时转为下一次可执行的改进；AI 草稿与教师文字始终分开</p></div><button className="v2-primary" disabled={busy} onClick={() => openEditor()}>＋ 新建反思</button></header><form className="v2-reflection-filters" onSubmit={applyFilters}><label>全文搜索<input value={text(filters.q, "")} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}/></label><label>主题标签<input value={text(filters.tag, "")} onChange={(event) => setFilters((current) => ({ ...current, tag: event.target.value }))}/></label><label>月份<input type="month" value={text(filters.month, "")} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}/></label><label>课题<input value={text(filters.topic, "")} onChange={(event) => setFilters((current) => ({ ...current, topic: event.target.value }))}/></label><label>问题类型<select value={text(filters.problemType, "")} onChange={(event) => setFilters((current) => ({ ...current, problemType: event.target.value }))}><option value="">全部问题类型</option>{["课堂节奏", "知识理解", "材料分析", "规范表达", "课堂参与", "作业落实", "价值引领", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label><ClassPicker endpoint="/api/v2/classes/options" includeAll label="班级" value={text(filters.classId, "")} onChange={(value) => setFilters((current) => ({ ...current, classId: value }))} onError={setError}/><button className="v2-primary">应用筛选</button><button type="button" className="v2-secondary-on-light" onClick={() => { setFilters({ q: "", tag: "", month: "", topic: "", problemType: "", classId: "" }); setAppliedQuery(""); }}>重置</button></form><div className="v2-reflection-view-tabs"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>列表</button><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>日历</button><span>{rows.length} 条记录 · {strategies.length} 条可复用策略</span></div></section>
    {loading ? <AnalyticsState title="正在读取反思" detail="只加载当前筛选范围内的真实私密记录。"/> : view === "calendar" ? <section className="v2-card"><header className="v2-card-head"><div><h2>{calendarMonth} 反思日历</h2><p>日历只显示已有记录摘要</p></div></header><div className="v2-reflection-calendar"><div>{["一", "二", "三", "四", "五", "六", "日"].map((day) => <b key={day}>周{day}</b>)}</div><section>{Array.from({ length: calendar.offset }, (_, index) => <i key={`blank-${index}`}/>)}{calendar.days.map((date) => { const items = rows.filter((row) => text(row.date) === date); return <article key={date}><b>{Number(date.slice(-2))}</b>{items.slice(0, 2).map((row) => <button key={String(row.id)} onClick={() => void openDetail(row)}>{text(row.lessonTopic, text(row.problemType, "教学反思"))}</button>)}{items.length > 2 && <small>另 {items.length - 2} 条</small>}</article>; })}</section></div></section> : <div className="v2-reflection-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>真实课后记录</h2><p>完整内容默认私密</p></div></header><div className="v2-reflection-list">{rows.map((row) => <article key={String(row.id)}><header><time>{text(row.date)}</time><div><Status value="私密"/><Status value={Boolean(row.actionCompleted) ? "动作已完成" : "待行动"} tone={Boolean(row.actionCompleted) ? "completed" : "warning"}/>{Boolean(row.isStrategy) && <Status value="已沉淀策略"/>}</div></header><h3>{text(row.lessonTopic, text(row.courseName, "独立教学反思"))}</h3><p>{text(row.difficulties, "尚未记录真实困难").slice(0, 130)}</p><small>{text(row.className, "未关联班级")} · {text(row.problemType, "问题类型待补")} · {text(row.tags, "标签待补")}</small><footer><button onClick={() => void openDetail(row)}>查看详情</button><button onClick={() => openEditor(row)}>编辑</button><button disabled={busy || Boolean(row.actionCompleted)} onClick={() => void updateReflection(row, { actionCompleted: true }, "改进动作已标记完成。")}>完成行动</button><button disabled={busy || Boolean(row.isStrategy)} onClick={() => void promote(row)}>沉淀为策略</button><button className="danger" disabled={busy} onClick={() => void remove(row)}>删除</button></footer></article>)}{!rows.length && <Empty title="还没有教学反思" detail="完成一节真实课后，再记录预设与实际差异。这里不会填充虚构内容。"/>}</div></section><aside className="v2-card v2-reflection-detail"><header className="v2-card-head"><div><h2>反思详情</h2><p>证据、行动与策略沉淀依据</p></div>{selected && <button onClick={() => setSelected(null)}>×</button>}</header>{detailLoading ? <p>正在加载详情…</p> : selected ? <div><h3>{text(selected.lessonTopic, text(selected.courseName, "独立反思"))}</h3>{[["预设与实际", "expectedVsActual"], ["有效做法", "effectivePractices"], ["真实困难", "difficulties"], ["学生证据", "studentEvidence"], ["下一步行动", "nextAction"], ["可复用素材", "reusableMaterial"]].map(([label, key]) => <section key={key}><b>{label}</b><p>{text(selected[key], "信息不足")}</p></section>)}</div> : <p>从列表或日历选择一条记录查看完整内容。</p>}</aside></div>}
    {editorOpen && <div className="v2-reflection-backdrop" role="presentation"><div className="v2-reflection-dialog" role="dialog" aria-modal="true" aria-labelledby="reflection-editor-title" aria-describedby="reflection-editor-boundary" tabIndex={-1} ref={dialogRef}><header><div><p>创建 / 编辑</p><h2 id="reflection-editor-title">{editingId ? "编辑私密反思" : "新建私密反思"}</h2></div><button aria-label="关闭反思编辑器" disabled={busy || aiBusy} onClick={dismissEditor}>×</button></header><p id="reflection-editor-boundary" className="v2-form-note">AI 草稿不会自动保存、发布或覆盖教师文字；反思完整内容默认私密。</p><div className="v2-reflection-editor-grid"><label>日期<input type="date" value={text(form.date, "")} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}/></label><label>关联真实课时<select value={text(form.lessonId, "")} onChange={(event) => { if (aiDraft && !window.confirm("切换课时会丢弃当前 AI 草稿，确认继续？")) return; setForm((current) => ({ ...current, lessonId: event.target.value })); setAiDraft(null); setAiMeta(null); }}><option value="">暂不关联</option>{text(form.lessonId, "") && !lessons.some((row) => String(row.id) === text(form.lessonId, "")) && <option value={text(form.lessonId, "")}>{text(form.date)} · 历史关联课时</option>}{lessons.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.date)} · {text(row.topic, text(row.courseName))}</option>)}</select></label><label>问题类型<select value={text(form.problemType, "")} onChange={(event) => setForm((current) => ({ ...current, problemType: event.target.value }))}><option value="">待补充</option>{["课堂节奏", "知识理解", "材料分析", "规范表达", "课堂参与", "作业落实", "价值引领", "其他"].map((item) => <option key={item}>{item}</option>)}</select></label><label>主题标签<input value={text(form.tags, "")} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}/></label>{[["预设与实际", "expectedVsActual"], ["有效做法", "effectivePractices"], ["真实困难", "difficulties"], ["学生证据", "studentEvidence"], ["下一步行动", "nextAction"], ["可复用素材", "reusableMaterial"]].map(([label, key]) => <label className="wide" key={key}>{label}<textarea rows={3} value={text(form[key], "")} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}/></label>)}<label className="v2-check wide"><input type="checkbox" checked={Boolean(form.actionCompleted)} onChange={(event) => setForm((current) => ({ ...current, actionCompleted: event.target.checked }))}/>改进动作已经完成</label></div><section className="v2-reflection-ai"><header><div><b>✦ AI 反思草稿</b><small>只读取所选真实课时；先生成独立草稿，再由教师选择采用</small></div><button disabled={aiBusy || !text(form.lessonId, "")} onClick={() => void generateAiDraft()}>{aiBusy ? "正在生成…" : "生成 AI 草稿"}</button></header>{aiDraft && <div><p>草稿尚未保存。采用时只补充空白字段，已有教师文字保持不变。</p><div className="v2-evidence-chips"><span><b>隐私确认</b>{Array.isArray(aiMeta?.sentFields) ? aiMeta?.sentFields.join("、") : "只发送允许字段"}</span><span><b>字段排除</b>{Array.isArray(aiMeta?.excludedFields) ? aiMeta?.excludedFields.join("、") : "身份与密钥字段"}</span><span><b>费用边界</b>不限制 token；只防重复与失控循环</span></div><button onClick={applyAiDraft}>采用草稿</button><button className="danger" onClick={() => { setAiDraft(null); setAiMeta(null); setNotice("AI 草稿已丢弃，教师文字未改变。"); }}>丢弃草稿</button></div>}</section><footer><button className="v2-secondary-on-light" disabled={busy || aiBusy} onClick={dismissEditor}>取消</button><button className="v2-primary" disabled={busy || aiBusy} onClick={() => void save()}>{busy ? "保存中…" : "私密保存"}</button></footer></div></div>}
  </div>;
}

function LearningOverview({ data, query, submit, creating }: { data: WorkspaceData; query: string; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
  const teaching = (data.analytics.teaching || {}) as Row, classroom = (data.analytics.classroom || {}) as Row, growth = (data.analytics.growth || {}) as Row;
  const feedback = data.feedback.filter((row) => includes(row, query, ["content", "type", "status"])).slice(0, 12), reflections = data.reflections.filter((row) => includes(row, query, ["difficulties", "nextAction", "lessonTopic", "tags"])).slice(0, 12);
  const [actionNotice, setActionNotice] = useState("");
  const requestSend = async (row: Row) => { try { await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "feedback.send", entityType: "feedback", entityId: String(row.id), title: "发送已确认反馈", summary: text(row.content).slice(0, 500), payload: { id: number(row.id), audience: row.audience }, evidence: Array.isArray(row.evidence) ? row.evidence : [] }) }); setActionNotice("反馈发送已进入待确认中心，当前尚未发送给学生或家长。"); } catch (caught) { setActionNotice(caught instanceof Error ? caught.message : "发送确认创建失败"); } };
  return <><MetricStrip items={[{ label: "近 30 天课时", value: number(teaching.lessons), detail: `完成率 ${text(teaching.completedRate, "暂无")}％` }, { label: "作业完成率", value: text(classroom.homeworkRate, "—"), detail: "基于真实提交" }, { label: "测评平均分", value: text(classroom.assessmentAverage, "—"), detail: `${number(classroom.assessmentCount)} 次测评` }, { label: "教学反思", value: number(growth.reflections), detail: `行动率 ${text(growth.actionRate, "暂无")}％` }]}/>{actionNotice && <p className="v2-alert">{actionNotice}</p>}<div className="v2-learning-grid"><section className="v2-card"><header className="v2-card-head"><div><h2>证据化反馈</h2><p>确认前保留课时、作业或测评来源</p></div><Link href="/v2/assistant">✦ 起草反馈</Link></header><div className="v2-native-list compact">{feedback.map((row) => <article key={String(row.id)}><div className="v2-avatar">馈</div><div><h3>{text(row.type, "课程反馈")}</h3><p>{text(row.content).slice(0, 100)}</p><span>证据 {Array.isArray(row.evidence) ? row.evidence.length : 0} 条 · {text(row.updatedAt, "")}</span>{text(row.status) === "confirmed" && !row.sentAt && <button className="v2-row-inline-button" onClick={() => void requestSend(row)}>提交发送确认</button>}</div><Status value={row.sentAt ? "已发送" : statusNames[text(row.status)] || text(row.status)}/></article>)}{!feedback.length && <Empty title="暂无反馈" detail="智能助手可以基于真实证据生成草稿。"/>}</div></section><section className="v2-card"><header className="v2-card-head"><div><h2>反思与行动</h2><p>把问题沉淀为下次可执行的调整</p></div></header><div className="v2-native-list compact">{reflections.map((row) => <article key={String(row.id)}><div className="v2-avatar">思</div><div><h3>{text(row.lessonTopic, text(row.problemType, "教学反思"))}</h3><p>{text(row.difficulties, "尚未填写主要困难").slice(0, 100)}</p><span>下一步：{text(row.nextAction, "待补充")}</span></div><Status value={Boolean(row.actionCompleted) ? "已执行" : "待行动"} tone={Boolean(row.actionCompleted) ? "completed" : "warning"}/></article>)}</div></section><section className="v2-card v2-reflection-form"><header className="v2-card-head"><div><h2>记录一条教学反思</h2><p>默认仅教师可见</p></div></header><form className="v2-form" onSubmit={submit}><label>日期<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}/></label><label>问题类型<input name="problemType" placeholder="课堂节奏、理解障碍…"/></label><label>真实困难<textarea name="difficulties" rows={4}/></label><label>下一步行动<textarea name="nextAction" rows={3}/></label><button className="v2-primary" disabled={creating}>{creating ? "保存中…" : "保存反思"}</button></form></section></div></>;
}

function ResourceWorkspace({ data, query, submit, creating }: { data: WorkspaceData; query: string; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
  const rows = data.resources.filter((row) => includes(row, query, ["title", "tags", "content", "type"]));
  return <><MetricStrip items={[{ label: "全部资源", value: data.resources.length, detail: "当前可见范围" }, { label: "公开资源", value: number(data.resourceSummary.publicCount), detail: "学生端可读取" }, { label: "私有资源", value: data.resources.filter((row) => text(row.visibility) !== "public").length, detail: "仅工作室成员" }, { label: "热门标签", value: Array.isArray(data.resourceSummary.popularTags) ? data.resourceSummary.popularTags.length : 0, detail: "用于快速归类" }]}/><div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>教学资源库</h2><p>外部链接仅允许 HTTPS/HTTP，私有文件始终鉴权</p></div></header><div className="v2-native-grid">{rows.map((row) => <article key={String(row.id)}><header><span>资</span><Status value={statusNames[text(row.visibility)] || text(row.visibility)}/></header><h3>{text(row.title)}</h3><p>{text(row.content, text(row.url, "暂无摘要")).slice(0, 120)}</p><footer><span>{text(row.type, "素材")}</span><span>{text(row.tags, "未标标签")}</span></footer><Link className="v2-row-action" href={`/v2/detail/resources/${row.id}`}>打开并编辑资源</Link></article>)}{!rows.length && <Empty title="没有匹配的资源" detail="从右侧添加一条私有教学素材。"/>}</div></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>添加私有资源</h2><p>公开前仍需显式调整可见范围</p></div></header><form className="v2-form" onSubmit={submit}><label>资源名称<input name="title" required/></label><label>类型<select name="type"><option>备课素材</option><option>教学策略</option><option>课件</option><option>外部链接</option></select></label><label>链接<input name="url" type="url" placeholder="https://"/></label><label>标签<input name="tags" placeholder="高二, 论述题"/></label><label>摘要<textarea name="content" rows={5}/></label><button className="v2-primary" disabled={creating}>{creating ? "保存中…" : "保存为私有资源"}</button></form></section></div></>;
}

function FinanceWorkspaceV2({ data, query, reload }: { data: WorkspaceData; query: string; reload: () => Promise<void> }) {
  const initialMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date());
  const [month, setMonth] = useState(initialMonth);
  const [monthly, setMonthly] = useState<Row>({});
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [target, setTarget] = useState<Row | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<Row | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadMonthly = useCallback(async () => {
    setMonthlyLoading(true); setError("");
    try { setMonthly(await requestJson(`/api/v2/finance/monthly?month=${encodeURIComponent(month)}`)); }
    catch (caught) { setMonthly({}); setError(caught instanceof Error ? caught.message : "月度核对清单读取失败"); }
    finally { setMonthlyLoading(false); }
  }, [month]);
  useEffect(() => { void loadMonthly(); }, [loadMonthly]);

  const rows = data.finance.filter((row) => (!status || text(row.status) === status) && includes(row, query, ["courseName", "topic", "institutionName", "status", "date"]));
  const monthlyRows = Array.isArray(monthly.items) ? monthly.items as Row[] : [];
  const monthlySummary = (monthly.summary || {}) as Row;

  const submitApproval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!target) return;
    setBusy(true); setError(""); setNotice(""); setPreview(null);
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    const adjustment = fields.adjustment.trim() === "" ? Number.NaN : Number(fields.adjustment);
    if (!Number.isFinite(adjustment)) { setError("调整金额必须是有效数字；无调整时请输入 0。"); setBusy(false); return; }
    try {
      const result = await requestJson("/api/v2/finance/approvals", { method: "POST", body: JSON.stringify({ lessonId: number(target.lessonId), payerType: text(target.payer_type, "parent"), payerId: target.payer_id, adjustment, adjustmentReason: fields.adjustmentReason }) });
      setPreview({ ...((result.preview || {}) as Row), formula: result.formula, approval: result.approval });
      setNotice("结算预览已生成并进入待确认中心；批准前不会写入正式账目。");
      setTarget(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "结算确认创建失败"); }
    finally { setBusy(false); }
  };

  const submitReceipt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!receiptTarget) return;
    setBusy(true); setError(""); setNotice("");
    const value = String(new FormData(event.currentTarget).get("receivedAmount") || "").trim(), receivedAmount = Number(value);
    if (!value || !Number.isFinite(receivedAmount) || receivedAmount < 0) { setError("实收金额必须是非负数字。"); setBusy(false); return; }
    try { await requestJson("/api/v2/finance/receipts", { method: "POST", body: JSON.stringify({ lessonId: number(receiptTarget.lessonId), receivedAmount }) }); setNotice("实收更新已进入待确认中心；批准前账面金额不会变化。"); setReceiptTarget(null); await reload(); await loadMonthly(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "实收确认创建失败"); }
    finally { setBusy(false); }
  };

  return <>
    <MetricStrip items={[{ label: "应收", value: money(data.financeTotals.expected), detail: "已纳入范围" }, { label: "实收", value: money(data.financeTotals.received), detail: "按确认记录" }, { label: "待收", value: money(data.financeTotals.pendingAmount), detail: "尚未完成" }, { label: "异常核对", value: money(number(data.financeTotals.underpaidAmount) + number(data.financeTotals.overpaidAmount) + number(data.financeTotals.reviewAmount)), detail: "少收、多收与待审" }]}/>
    {notice && <p className="v2-alert" role="status">{notice}</p>}{error && <p className="v2-alert v2-error" role="alert">{error}</p>}
    <section className="v2-card v2-finance-monthly">
      <header className="v2-card-head"><div><h2>月度课时核对</h2><p>覆盖本月全部非取消课时；金额缺失保留为“待生成”，不会用 0 代替</p></div><div className="v2-detail-actions"><label className="v2-compact-field">月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)}/></label><a className="v2-secondary-on-light" href={`/api/v2/finance/export?mode=monthly&month=${month}`}>导出本月核对表</a><a className="v2-secondary-on-light" href="/api/v2/finance/export?type=institution">导出机构明细</a><a className="v2-secondary-on-light" href="/api/v2/finance/export?type=parent">导出家长明细</a></div></header>
      <div className="v2-evidence-chips"><span><b>{number(monthlySummary.lessons)}</b>课时</span><span><b>{number(monthlySummary.completed)}</b>已完成</span><span><b>{number(monthlySummary.future)}</b>未来未到期</span><span><b>{number(monthlySummary.exceptions)}</b>异常</span></div>
      <div className={`v2-table ${monthlyLoading ? "v2-loading" : ""}`}><table><thead><tr><th>日期</th><th>课时</th><th>生命周期</th><th>规则</th><th>应收</th><th>实收</th><th>差额</th><th>异常依据</th></tr></thead><tbody>{monthlyRows.map((row) => <tr key={String(row.lessonId)}><td>{text(row.date)}<br/><small>{text(row.startTime, "时间待补")}</small></td><td><b>{text(row.topic, text(row.courseName))}</b><br/><small>{text(row.className, "班级待补")}</small></td><td>{text(row.lifecycle)}</td><td>{row.pricingRuleId ? `#${row.pricingRuleId}` : "待补"}</td><td>{row.financeId ? money(row.expectedAmount) : "待生成"}</td><td>{row.financeId ? money(row.receivedAmount) : "—"}</td><td>{row.financeId ? money(row.difference) : "—"}</td><td>{Array.isArray(row.exceptions) && row.exceptions.length ? <span className="v2-finance-exception">{row.exceptions.join("；")}</span> : "无异常"}</td></tr>)}</tbody></table>{!monthlyLoading && !monthlyRows.length && <Empty title="本月暂无非取消课时" detail="没有生成虚构的月度金额。"/>}</div>
    </section>
    <section className="v2-card"><header className="v2-card-head"><div><h2>正式课时账目</h2><p>金额来自真实课时、出勤与计费规则；所有入账和实收变更都需确认</p></div><div className="v2-detail-actions"><label className="v2-compact-field">状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="review">待核对</option><option value="pending">待收</option><option value="settled">已收清</option><option value="underpaid">少收</option><option value="overpaid">超收</option></select></label><Status value="审批后入账" tone="warning"/></div></header><div className="v2-table"><table><thead><tr><th>日期</th><th>课程</th><th>规则来源</th><th>付款方</th><th>应收</th><th>实收</th><th>差额</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{text(row.date)}</td><td><b>{text(row.courseName)}</b><br/><small>{text(row.topic, "")}</small></td><td>{row.pricingRuleId ? `规则 #${row.pricingRuleId}` : "规则待补"}</td><td>{text(row.institutionName, text(row.payer_type, "家长"))}</td><td>{money(row.expectedAmount)}</td><td>{money(row.receivedAmount)}</td><td>{money(row.difference)}</td><td><Status value={statusNames[text(row.status)] || text(row.status)}/></td><td>{text(row.status) === "review" ? <button className="v2-row-action" onClick={() => { setTarget(row); setReceiptTarget(null); setPreview(null); setNotice(""); setError(""); }}>生成结算预览</button> : row.confirmed_at ? <button className="v2-row-action" onClick={() => { setReceiptTarget(row); setTarget(null); setNotice(""); setError(""); }}>登记实收</button> : "—"}</td></tr>)}</tbody></table>{!rows.length && <Empty title="暂无结算记录" detail="完成课时并配置计费规则后，这里会出现可核对项目。"/>}</div></section>
    {target && <section className="v2-card v2-finance-confirm"><header className="v2-card-head"><div><h2>生成结算预览</h2><p>{text(target.date)} · {text(target.courseName)} · 系统会重新检查计费规则和出勤</p></div><button className="v2-secondary-on-light" onClick={() => setTarget(null)}>取消</button></header><form className="v2-form" onSubmit={submitApproval}><label>调整金额<input name="adjustment" type="number" step="0.01" defaultValue="0" required/></label><label>调整原因（调整不为 0 时必填）<input name="adjustmentReason"/></label><button className="v2-primary" disabled={busy}>{busy ? "正在校验…" : "生成预览并提交确认"}</button></form></section>}
    {preview && <section className="v2-card v2-finance-preview"><header className="v2-card-head"><div><h2>逐项计算预览</h2><p>预览已经固化到待确认项；批准时仍会重新校验当前规则和出勤</p></div><Status value="待教师确认" tone="warning"/></header><code>{text(preview.formula)}</code><div className="v2-table"><table><thead><tr><th>学生</th><th>出勤</th><th>计费系数</th><th>单价</th><th>金额</th><th>依据</th></tr></thead><tbody>{(Array.isArray(preview.items) ? preview.items as Row[] : []).map((item) => <tr key={String(item.studentId)}><td>学生 #{text(item.studentId)}</td><td>{text(item.status)}</td><td>{text(item.factor)}</td><td>{money(item.unitFee)}</td><td>{money(item.amount)}</td><td>{text(item.reason)}</td></tr>)}</tbody></table></div><Link className="v2-primary" href="/v2/approvals">前往待确认中心</Link></section>}
    {receiptTarget && <section className="v2-card v2-finance-confirm"><header className="v2-card-head"><div><h2>登记实际收款</h2><p>{text(receiptTarget.date)} · {text(receiptTarget.courseName)} · 当前实收 {money(receiptTarget.receivedAmount)}</p></div><button className="v2-secondary-on-light" onClick={() => setReceiptTarget(null)}>取消</button></header><form className="v2-form" onSubmit={submitReceipt}><label>新的累计实收金额<input name="receivedAmount" type="number" min="0" step="0.01" defaultValue={number(receiptTarget.receivedAmount)} required/></label><p className="v2-form-note">批准时会再次比较当前实收金额；若其他设备已更新，本次操作会中止。</p><button className="v2-primary" disabled={busy}>{busy ? "正在校验…" : "提交实收到待确认中心"}</button></form></section>}
  </>;
}

function MetricStrip({ items }: { items: Array<{ label: string; value: string | number; detail: string }> }) { return <section className="v2-metric-grid v2-four-metrics">{items.map((item) => <article className="v2-metric" key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></article>)}</section>; }
function Status({ value, tone }: { value: string; tone?: string }) { const inferred = tone || (/待|风险|少收|多收|核对/.test(value) ? "warning" : /取消|失败/.test(value) ? "failed" : "completed"); return <em className={`v2-status ${inferred}`}>{value}</em>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="v2-empty"><b>{title}</b>{detail}</div>; }
