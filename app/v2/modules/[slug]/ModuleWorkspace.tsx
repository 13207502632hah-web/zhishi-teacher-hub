"use client";

import Link from "../../../components/HardNavigationLink";
import { FormEvent, useCallback, useEffect, useState } from "react";

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
  if (!response.ok) throw new Error(String(payload.error || `请求失败（${response.status}）`));
  return payload;
}

const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const number = (value: unknown) => Number(value || 0);
const money = (value: unknown) => `¥${number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const includes = (row: Row, query: string, fields: string[]) => !query || fields.some((field) => text(row[field], "").toLowerCase().includes(query.toLowerCase()));
const statusNames: Record<string, string> = { active: "进行中", archived: "已归档", draft: "草稿", scheduled: "待上课", completed: "已完成", cancelled: "已取消", published: "已发布", confirmed: "已确认", submitted: "待批改", revision: "待订正", private: "仅教师", public: "公开", pending: "待处理", underpaid: "少收", overpaid: "多收", review: "待核对", settled: "已结算" };

export function ModuleWorkspace({ slug }: { slug: ModuleSlug }) {
  const [data, setData] = useState<WorkspaceData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [studentTab, setStudentTab] = useState<"students" | "classes" | "lessons">("students");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (slug === "students") {
        const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
        const [students, classes, lessons] = await Promise.all([requestJson("/api/v2/students?status=active"), requestJson("/api/v2/classes?status=active&pageSize=200"), requestJson(`/api/v2/lessons?from=${from}`)]);
        setData({ ...emptyData, students: (students.students || []) as Row[], classes: (classes.classes || []) as Row[], lessons: (lessons.lessons || []) as Row[] });
      } else if (slug === "assignments") {
        const [assignments, classes] = await Promise.all([requestJson("/api/v2/assignments"), requestJson("/api/v2/classes?status=active&pageSize=200")]);
        setData({ ...emptyData, assignments: (assignments.assignments || []) as Row[], assignmentCounts: (assignments.counts || {}) as Row, classes: (classes.classes || []) as Row[] });
      } else if (slug === "papers") {
        const papers = await requestJson("/api/v2/papers");
        setData({ ...emptyData, papers: (papers.papers || []) as Row[] });
      } else if (slug === "learning") {
        const [analytics, feedback, reflections] = await Promise.all([requestJson("/api/v2/analytics?range=month"), requestJson("/api/v2/feedback"), requestJson("/api/v2/reflections")]);
        setData({ ...emptyData, analytics, feedback: (feedback.feedback || []) as Row[], reflections: (reflections.reflections || []) as Row[] });
      } else if (slug === "resources") {
        const resources = await requestJson("/api/v2/resources?scope=all");
        setData({ ...emptyData, resources: (resources.resources || []) as Row[], resourceSummary: (resources.summary || {}) as Row });
      } else {
        const finance = await requestJson("/api/v2/finance");
        setData({ ...emptyData, finance: (finance.items || []) as Row[], financeTotals: (finance.totals || {}) as Row });
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "工作台暂时无法读取数据"); }
    finally { setLoading(false); }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setCreating(true); setError(""); setNotice("");
    const form = event.currentTarget, formData = new FormData(form);
    const values = Object.fromEntries(formData.entries()) as Record<string, string>;
    try {
      let path = ""; let payload: Row = { ...values };
      if (slug === "students" && studentTab === "students") { path = "/api/v2/students"; payload = { ...values, classId: values.classId ? Number(values.classId) : null }; }
      if (slug === "students" && studentTab === "classes") path = "/api/v2/classes";
      if (slug === "students" && studentTab === "lessons") { path = "/api/v2/lessons"; payload = { ...values, classId: values.classId ? Number(values.classId) : null, status: "draft" }; }
      if (slug === "assignments") { path = "/api/v2/assignments"; payload = { ...values, classId: Number(values.classId), status: "draft", operationId: crypto.randomUUID(), assetIds: formData.getAll("assetIds").map(Number).filter(Boolean), allowParentSubmit: formData.get("allowParentSubmit") === "on", requireRevision: formData.get("requireRevision") === "on" }; }
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
  if (slug === "students") content = <PeopleWorkspace data={data} query={query} tab={studentTab} setTab={setStudentTab} submit={submit} creating={creating}/>;
  else if (slug === "assignments") content = <AssignmentWorkspace data={data} query={query} submit={submit} creating={creating}/>;
  else if (slug === "papers") content = <PaperWorkspace rows={data.papers.filter((row) => includes(row, query, ["title", "stage", "grade", "source"]))}/>;
  else if (slug === "learning") content = <LearningWorkspace data={data} query={query} submit={submit} creating={creating}/>;
  else if (slug === "resources") content = <ResourceWorkspace data={data} query={query} submit={submit} creating={creating}/>;
  else content = <FinanceWorkspace data={data} query={query} reload={load}/>;

  return <>
    <section className="v2-workspace-toolbar"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前工作台中筛选…"/></label><button onClick={() => void load()} disabled={loading}>↻ 刷新数据</button><small>网页、iOS 与小程序共用同一份 D1/R2 数据</small></section>
    {error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}
    <div className={loading ? "v2-loading" : ""}>{content}</div>
  </>;
}

function PeopleWorkspace({ data, query, tab, setTab, submit, creating }: { data: WorkspaceData; query: string; tab: "students" | "classes" | "lessons"; setTab: (value: "students" | "classes" | "lessons") => void; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
  const rows = tab === "students" ? data.students.filter((row) => includes(row, query, ["name", "nickname", "grade", "school", "classNames"])) : tab === "classes" ? data.classes.filter((row) => includes(row, query, ["name", "stage", "grade"])) : data.lessons.filter((row) => includes(row, query, ["courseName", "topic", "className", "studentNames"]));
  return <>
    <MetricStrip items={[{ label: "在读学生", value: data.students.length, detail: "活跃档案" }, { label: "进行中班级", value: data.classes.length, detail: "含一对一与班课" }, { label: "近 60 天课时", value: data.lessons.length, detail: "实际课表记录" }, { label: "已确认风险", value: data.students.filter((row) => Boolean(row.riskConfirmed)).length, detail: "仅教师可见" }]}/>
    <div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>教学对象</h2><p>档案、班级与课时在同一上下文切换</p></div><TabBar value={tab} setValue={setTab}/></header><div className="v2-native-list">
      {rows.map((row) => tab === "students" ? <article key={String(row.id)}><div className="v2-avatar">{text(row.name).slice(0, 1)}</div><div><Link className="v2-entity-link" href={`/v2/detail/students/${row.id}`}><h3>{text(row.name)} <small>{text(row.grade)}</small></h3></Link><p>{text(row.classNames, "尚未加入班级")} · {text(row.school, "学校未填")}</p><span>{text(row.stageGoal, "暂未设置阶段目标")}</span></div><Status value={Boolean(row.riskConfirmed) ? "需关注" : "档案正常"} tone={Boolean(row.riskConfirmed) ? "warning" : "completed"}/></article> : tab === "classes" ? <article key={String(row.id)}><div className="v2-avatar">班</div><div><Link className="v2-entity-link" href={`/v2/detail/classes/${row.id}`}><h3>{text(row.name)} <small>{text(row.stage)} · {text(row.grade)}</small></h3></Link><p>{number(row.studentCount)} 名学生 · {number(row.lessonCount)} 节课</p><span>{text(row.schedule, "上课时间待安排")}</span></div><Status value={statusNames[text(row.status, "active")] || text(row.status)}/></article> : <article key={String(row.id)}><div className="v2-avatar">课</div><div><Link className="v2-entity-link" href={`/v2/detail/lessons/${row.id}`}><h3>{text(row.courseName)} <small>{text(row.date)} {text(row.startTime, "")}</small></h3></Link><p>{text(row.className, text(row.studentNames, "未关联班级"))}</p><span>{text(row.topic, "课题与备课内容待补充")}</span></div><Status value={statusNames[text(row.status)] || text(row.status)}/></article>)}
      {!rows.length && <Empty title="没有符合条件的数据" detail="调整筛选，或从右侧建立第一条记录。"/>}
    </div></section><CreatePeopleForm tab={tab} classes={data.classes} submit={submit} creating={creating}/></div>
  </>;
}

function TabBar({ value, setValue }: { value: "students" | "classes" | "lessons"; setValue: (value: "students" | "classes" | "lessons") => void }) { return <div className="v2-tabs">{[["students", "学生"], ["classes", "班级"], ["lessons", "课时"]].map(([key, label]) => <button className={value === key ? "active" : ""} key={key} onClick={() => setValue(key as typeof value)}>{label}</button>)}</div>; }

function CreatePeopleForm({ tab, classes, submit, creating }: { tab: "students" | "classes" | "lessons"; classes: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
  return <section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>{tab === "students" ? "新建学生档案" : tab === "classes" ? "新建班级" : "新建课时草稿"}</h2><p>保存后立即参与三端数据同步</p></div></header><form className="v2-form" onSubmit={submit}>
    {tab === "students" && <><label>学生姓名<input name="name" required maxLength={40}/></label><label>年级<input name="grade" required placeholder="如：高二"/></label><label>学校<input name="school"/></label><label>加入班级<select name="classId"><option value="">暂不加入</option>{classes.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label><label>阶段目标<textarea name="stageGoal" rows={3}/></label></>}
    {tab === "classes" && <><label>班级名称<input name="name" required maxLength={80}/></label><label>学段<input name="stage" required placeholder="如：高中"/></label><label>年级<input name="grade" required placeholder="如：高二"/></label><label>课程类型<select name="courseType"><option>一对多</option><option>一对一</option></select></label><label>常规安排<input name="schedule" placeholder="每周六 14:00"/></label></>}
    {tab === "lessons" && <><label>日期<input name="date" type="date" required/></label><div className="v2-form-pair"><label>开始<input name="startTime" type="time"/></label><label>结束<input name="endTime" type="time"/></label></div><label>课程名称<input name="courseName" required/></label><div className="v2-form-pair"><label>学段<input name="stage" required/></label><label>年级<input name="grade" required/></label></div><label>关联班级<select name="classId"><option value="">不关联</option>{classes.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label><label>课题<input name="topic"/></label></>}
    <button className="v2-primary" disabled={creating}>{creating ? "正在保存…" : "保存"}</button>
  </form></section>;
}

function AssignmentWorkspace({ data, query, submit, creating }: { data: WorkspaceData; query: string; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
  const rows = data.assignments.filter((row) => includes(row, query, ["title", "requirements", "className", "paperTitle"]));
  const [selectedId, setSelectedId] = useState(0), [submissions, setSubmissions] = useState<Row[]>([]), [reviewLoading, setReviewLoading] = useState(false), [reviewNotice, setReviewNotice] = useState(""), [assets, setAssets] = useState<Array<{ id: number; name: string }>>([]), [uploading, setUploading] = useState(false);
  const uploadAssets = async (files: FileList | null) => { if (!files?.length) return; setUploading(true); setReviewNotice(""); try { const uploaded: Array<{ id: number; name: string }> = []; for (const file of Array.from(files)) { const body = new FormData(); body.append("file", file); const response = await fetch("/api/v2/assignments/files", { method: "POST", body }); const payload = await response.json().catch(() => ({})) as Row; if (!response.ok) throw new Error(text(payload.error, `${file.name} 上传失败`)); uploaded.push({ id: number(payload.id), name: text(payload.name, file.name) }); } setAssets((current) => [...current, ...uploaded]); } catch (caught) { setReviewNotice(caught instanceof Error ? caught.message : "附件上传失败"); } finally { setUploading(false); } };
  const requestPublish = async (row: Row) => { try { await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "assignment.publish", entityType: "assignment", entityId: String(row.id), title: `发布作业：${text(row.title)}`, summary: `向 ${number(row.recipientCount) || "班级内"} 名学生发布，截止时间 ${text(row.dueAt, "未设置")}。`, payload: { id: number(row.id), dueAt: row.dueAt }, evidence: [{ type: "assignment", id: row.id, requirements: row.requirements }] }) }); setReviewNotice("作业发布已进入待确认中心；当前仍是草稿。"); } catch (caught) { setReviewNotice(caught instanceof Error ? caught.message : "发布确认创建失败"); } };
  useEffect(() => { if (!selectedId && data.assignments.length) setSelectedId(number(data.assignments.find((row) => number(row.pendingReviewCount) > 0)?.id || data.assignments[0].id)); }, [data.assignments, selectedId]);
  useEffect(() => { if (!selectedId) return; let active = true; setReviewLoading(true); requestJson(`/api/v2/assignments/${selectedId}/submissions`).then((payload) => { if (active) setSubmissions((payload.submissions || []) as Row[]); }).catch((caught) => { if (active) setReviewNotice(caught instanceof Error ? caught.message : "提交队列读取失败"); }).finally(() => { if (active) setReviewLoading(false); }); return () => { active = false; }; }, [selectedId]);
  return <><MetricStrip items={[{ label: "全部作业", value: number(data.assignmentCounts.total), detail: "当前筛选范围" }, { label: "草稿", value: number(data.assignmentCounts.draft), detail: "尚未发布" }, { label: "待批改", value: number(data.assignmentCounts.pendingReview), detail: "学生已提交" }, { label: "待订正", value: number(data.assignmentCounts.revision), detail: "需要继续跟进" }]}/><div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>作业教学闭环</h2><p>发布状态、收交与订正进度集中查看</p></div></header><div className="v2-native-list">{rows.map((row) => <article key={String(row.id)} className={selectedId === number(row.id) ? "selected" : ""}><div className="v2-avatar">业</div><div><h3>{text(row.title)} <small>{text(row.className, "指定学生")}</small></h3><p>截止 {text(row.dueAt, "未设置")} · {number(row.recipientCount)} 人</p><span>待批 {number(row.pendingReviewCount)} · 待订正 {number(row.revisionCount)} · 完成 {number(row.completedCount)}</span><div className="v2-inline-actions"><button className="v2-row-inline-button" onClick={() => { setSelectedId(number(row.id)); setReviewNotice(""); }}>查看提交与批改</button>{text(row.status) === "draft" && <button className="v2-row-inline-button" onClick={() => void requestPublish(row)}>提交发布确认</button>}</div></div><Status value={statusNames[text(row.status)] || text(row.status)}/></article>)}{!rows.length && <Empty title="暂无作业" detail="可先建立草稿，正式发布需要再次确认。"/>}</div></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>新建作业草稿</h2><p>不会直接出现在学生端</p></div></header><form className="v2-form" onSubmit={submit}><label>标题<input name="title" required/></label><label>班级<select name="classId" required><option value="">请选择</option>{data.classes.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label><label>截止时间<input name="dueAt" type="datetime-local"/></label><label>要求<textarea name="requirements" rows={5}/></label><label className="v2-file-picker">作业附件<input type="file" multiple accept="image/*,audio/*,video/mp4,.pdf,.docx" onChange={(event) => void uploadAssets(event.target.files)}/><small>{uploading ? "上传中…" : assets.length ? assets.map((item) => item.name).join("、") : "图片、语音、视频、PDF 或 Word，单个 25MB 以内"}</small></label>{assets.map((item) => <input key={item.id} type="hidden" name="assetIds" value={item.id}/>)}<label className="v2-check"><input type="checkbox" name="allowParentSubmit" defaultChecked/>允许家长代交</label><label className="v2-check"><input type="checkbox" name="requireRevision" defaultChecked/>需要保留订正版</label><button className="v2-primary" disabled={creating || uploading}>{creating ? "保存中…" : "建立草稿"}</button><small className="v2-form-note">正式发布、提醒与发送继续由待确认中心负责。</small></form></section></div>{selectedId > 0 && <section className={`v2-card v2-review-queue ${reviewLoading ? "v2-loading" : ""}`}><header className="v2-card-head"><div><h2>提交与批改</h2><p>批改结果先生成待确认项；确认后才同步给学生和家长</p></div><Status value={`${submissions.length} 名学生`}/></header>{reviewNotice && <p className="v2-alert">{reviewNotice}</p>}<div className="v2-review-grid">{submissions.map((row) => <SubmissionReviewCard key={String(row.id)} assignmentId={selectedId} row={row} onCreated={() => setReviewNotice("批改建议已进入待确认中心；当前尚未向学生发送结果。")} />)}{!submissions.length && !reviewLoading && <Empty title="暂无学生提交记录" detail="作业发布并产生接收人后，这里会显示收交与批改状态。"/>}</div></section>}</>;
}

const v2ReviewTagOptions = ["观点准确", "材料对应充分", "政治术语规范", "答题层次清晰", "采分点完整", "观点不准确", "材料对应不足", "政治术语不规范", "答题层次不清", "采分点缺失"];

function SubmissionReviewCard({ assignmentId, row, onCreated }: { assignmentId: number; row: Row; onCreated: () => void }) {
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
  const createApproval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await requestJson("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "submission.review_confirm", entityType: "submission", entityId: String(row.id), title: `确认 ${text(row.studentName)} 的作业批改`, summary: `${draft.outcome === "revision" ? "要求订正" : "确认完成"}${draft.score ? `，得分 ${draft.score}` : ""}。确认后学生端立即可见。`, payload: { assignmentId, submissionId: number(row.id), outcome: draft.outcome, score: draft.score, reviewTags: draft.reviewTags, teacherNote: draft.teacherNote, revisionRequirements: draft.revisionRequirements, annotation: draft.annotation, reviewAssetIds: reviewAssets.map((asset) => asset.id) }, evidence: [{ type: "submission", id: row.id, version: row.latestVersion, excerpt: text(row.textContent, "学生未填写文字内容").slice(0, 300), attachmentIds: attachments.map((asset) => asset.id) }, ...(aiDraft ? [{ type: "ai_review_draft", confidence: aiDraft.confidence, evidence: aiDraft.evidence, uncertainty: aiDraft.uncertainty, model: aiDraft.model }] : [])] }) }); setDraft({ outcome: "completed", score: "", reviewTags: [], teacherNote: "", revisionRequirements: "", annotation: "" }); setReviewAssets([]); setAiDraft(null); onCreated(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "待确认项创建失败"); }
    finally { setBusy(false); }
  };
  const tagOptions = [...new Set([...v2ReviewTagOptions, ...draft.reviewTags])];
  return <article><header><div><b>{text(row.studentName)}</b><small>{statusNames[text(row.status)] || text(row.status)}</small></div><span>第 {number(row.latestVersion)} 版</span></header><p>{text(row.textContent, "本次提交仅包含附件或暂无文字内容")}</p>{attachments.length > 0 && <div className="v2-submission-assets">{attachments.map((asset) => text(asset.mimeType, "").startsWith("audio/") ? <audio key={String(asset.id)} controls preload="none" src={text(asset.url)} aria-label={text(asset.name)}/> : <a key={String(asset.id)} href={text(asset.url)} target="_blank" rel="noreferrer">{text(asset.name)}</a>)}</div>}<button type="button" className="v2-ai-review-button" disabled={busy || aiBusy} onClick={() => void generateAiReview()}>{aiBusy ? "✦ AI 正在核对证据…" : "✦ AI 生成批改建议"}</button>{aiDraft && <div className="v2-ai-review-result"><b>AI 草稿 · 置信度 {Math.round(number(aiDraft.confidence) * 100)}%</b><p>{text(aiDraft.summary)}</p><small>{text(aiDraft.scoreBasis, "未建议分数")} · 模型 {text(aiDraft.model)}</small>{Array.isArray(aiDraft.uncertainty) && aiDraft.uncertainty.length > 0 && <em>需教师核对：{aiDraft.uncertainty.map(String).join("；")}</em>}</div>}<form className="v2-form" onSubmit={createApproval}><div className="v2-form-pair"><label>处理结果<select value={draft.outcome} onChange={(event) => setDraft((current) => ({ ...current, outcome: event.target.value }))}><option value="completed">完成</option><option value="excellent">优秀</option><option value="revision">要求订正</option><option value="incomplete">未完成</option></select></label><label>分数<input value={draft.score} onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))} type="number" min="0" step="0.5"/></label></div><fieldset className="v2-review-tags"><legend>批改标签</legend>{tagOptions.map((tag) => <label key={tag}><input type="checkbox" checked={draft.reviewTags.includes(tag)} onChange={(event) => setDraft((current) => ({ ...current, reviewTags: event.target.checked ? [...current.reviewTags, tag] : current.reviewTags.filter((item) => item !== tag) }))}/>{tag}</label>)}</fieldset><label>教师评语<textarea value={draft.teacherNote} onChange={(event) => setDraft((current) => ({ ...current, teacherNote: event.target.value }))} rows={3}/></label><label>订正要求<textarea value={draft.revisionRequirements} onChange={(event) => setDraft((current) => ({ ...current, revisionRequirements: event.target.value }))} rows={2}/></label><label>定位批注<textarea value={draft.annotation} onChange={(event) => setDraft((current) => ({ ...current, annotation: event.target.value }))} rows={2} placeholder="指出具体段落、图片或答题步骤的问题"/></label><label className="v2-file-picker">语音或批改附件<input type="file" multiple accept="audio/*,image/*,.pdf" onChange={(event) => void uploadReviewAssets(event.target.files)}/><small>{reviewAssets.length ? reviewAssets.map((asset) => asset.name).join("、") : "可上传语音讲解、批注图或 PDF"}</small></label>{error && <small className="v2-form-error">{error}</small>}<button className="v2-primary" disabled={busy || aiBusy}>{busy ? "提交中…" : "提交到待确认中心"}</button></form></article>;
}

function PaperWorkspace({ rows }: { rows: Row[] }) {
  const totalQuestions = rows.reduce((sum, row) => sum + number(row.questionCount), 0);
  return <><MetricStrip items={[{ label: "试卷", value: rows.length, detail: "含草稿与正式卷" }, { label: "已选题", value: totalQuestions, detail: "所有试卷合计" }, { label: "待解析", value: rows.filter((row) => text(row.parse_status, text(row.parseStatus, "")) !== "completed").length, detail: "文件识别任务" }, { label: "可用正式卷", value: rows.filter((row) => text(row.status) === "active").length, detail: "可关联作业" }]}/><section className="v2-card"><header className="v2-card-head"><div><h2>试卷与选题篮</h2><p>智能生成会先解释选题理由，再进入教师确认</p></div><Link href="/v2/questions" className="v2-primary">从智能题库选题</Link></header><div className="v2-native-grid">{rows.map((row) => <article key={String(row.id)}><header><span>卷</span><Status value={statusNames[text(row.status)] || text(row.status)}/></header><Link className="v2-entity-link" href={`/v2/detail/papers/${row.id}`}><h3>{text(row.title)}</h3></Link><p>{text(row.stage, "学段未填")} · {text(row.grade, "年级未填")} · {text(row.type, "试卷")}</p><footer><span>{number(row.questionCount)} 题</span><span>{number(row.calculatedScore)} 分</span><span>{number(row.fileCount)} 个文件</span></footer></article>)}{!rows.length && <Empty title="还没有试卷" detail="先在智能题库完成检索与选题。"/>}</div></section></>;
}

function LearningWorkspace({ data, query, submit, creating }: { data: WorkspaceData; query: string; submit: (event: FormEvent<HTMLFormElement>) => void; creating: boolean }) {
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

function FinanceWorkspace({ data, query, reload }: { data: WorkspaceData; query: string; reload: () => Promise<void> }) {
  const rows = data.finance.filter((row) => includes(row, query, ["courseName", "topic", "institutionName", "status", "date"]));
  const [target, setTarget] = useState<Row | null>(null), [receiptTarget, setReceiptTarget] = useState<Row | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const submitApproval = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!target) return; setBusy(true); setError(""); const fields = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; try { const result = await requestJson("/api/v2/finance/approvals", { method: "POST", body: JSON.stringify({ lessonId: number(target.lessonId), payerType: text(target.payer_type, "parent"), payerId: target.payer_id, adjustment: Number(fields.adjustment || 0), adjustmentReason: fields.adjustmentReason }) }); const preview = (result.preview || {}) as Row; setNotice(`结算预览 ${money(preview.expectedAmount)} 已进入待确认中心，当前尚未入账。`); setTarget(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "结算确认创建失败"); } finally { setBusy(false); } };
  const submitReceipt = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!receiptTarget) return; setBusy(true); setError(""); const receivedAmount = Number(new FormData(event.currentTarget).get("receivedAmount")); try { await requestJson("/api/v2/finance/receipts", { method: "POST", body: JSON.stringify({ lessonId: number(receiptTarget.lessonId), receivedAmount }) }); setNotice("实收更新已进入待确认中心；批准前账面金额不会变化。"); setReceiptTarget(null); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "实收确认创建失败"); } finally { setBusy(false); } };
  return <><MetricStrip items={[{ label: "应收", value: money(data.financeTotals.expected), detail: "已纳入范围" }, { label: "实收", value: money(data.financeTotals.received), detail: "按确认记录" }, { label: "待收", value: money(data.financeTotals.pendingAmount), detail: "尚未完成" }, { label: "异常核对", value: money(number(data.financeTotals.underpaidAmount) + number(data.financeTotals.overpaidAmount) + number(data.financeTotals.reviewAmount)), detail: "少收、多收与待审" }]}/>{notice && <p className="v2-alert">{notice}</p>}{error && <p className="v2-alert v2-error">{error}</p>}<section className="v2-card"><header className="v2-card-head"><div><h2>课时结算证据</h2><p>金额来自真实课时与计费规则；提交后仍需在待确认中心核对</p></div><Status value="审批后入账" tone="warning"/></header><div className="v2-table"><table><thead><tr><th>日期</th><th>课程</th><th>付款方</th><th>应收</th><th>实收</th><th>差额</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{text(row.date)}</td><td><b>{text(row.courseName)}</b><br/><small>{text(row.topic, "")}</small></td><td>{text(row.institutionName, text(row.payer_type, "家长"))}</td><td>{money(row.expectedAmount)}</td><td>{money(row.receivedAmount)}</td><td>{money(row.difference)}</td><td><Status value={statusNames[text(row.status)] || text(row.status)}/></td><td>{text(row.status) === "review" ? <button className="v2-row-action" onClick={() => { setTarget(row); setReceiptTarget(null); setNotice(""); setError(""); }}>生成结算预览</button> : row.confirmed_at ? <button className="v2-row-action" onClick={() => { setReceiptTarget(row); setTarget(null); setNotice(""); setError(""); }}>登记实收</button> : "—"}</td></tr>)}</tbody></table>{!rows.length && <Empty title="暂无结算记录" detail="完成课时并配置计费规则后，这里会出现可核对项目。"/>}</div></section>{target && <section className="v2-card v2-finance-confirm"><header className="v2-card-head"><div><h2>提交结算确认</h2><p>{text(target.date)} · {text(target.courseName)} · 系统会重新检查计费规则和出勤</p></div><button className="v2-secondary-on-light" onClick={() => setTarget(null)}>取消</button></header><form className="v2-form" onSubmit={submitApproval}><label>调整金额<input name="adjustment" type="number" step="0.01" defaultValue="0"/></label><label>调整原因（调整不为 0 时必填）<input name="adjustmentReason"/></label><button className="v2-primary" disabled={busy}>{busy ? "正在校验…" : "生成预览并提交到待确认中心"}</button></form></section>}{receiptTarget && <section className="v2-card v2-finance-confirm"><header className="v2-card-head"><div><h2>登记实际收款</h2><p>{text(receiptTarget.date)} · {text(receiptTarget.courseName)} · 当前实收 {money(receiptTarget.receivedAmount)}</p></div><button className="v2-secondary-on-light" onClick={() => setReceiptTarget(null)}>取消</button></header><form className="v2-form" onSubmit={submitReceipt}><label>新的累计实收金额<input name="receivedAmount" type="number" min="0" step="0.01" defaultValue={number(receiptTarget.receivedAmount)} required/></label><p className="v2-form-note">批准时会再次比较当前实收金额；若其他设备已更新，本次操作会中止。</p><button className="v2-primary" disabled={busy}>{busy ? "正在校验…" : "提交实收到待确认中心"}</button></form></section>}</>;
}

function MetricStrip({ items }: { items: Array<{ label: string; value: string | number; detail: string }> }) { return <section className="v2-metric-grid v2-four-metrics">{items.map((item) => <article className="v2-metric" key={item.label}><span>{item.label}</span><b>{item.value}</b><small>{item.detail}</small></article>)}</section>; }
function Status({ value, tone }: { value: string; tone?: string }) { const inferred = tone || (/待|风险|少收|多收|核对/.test(value) ? "warning" : /取消|失败/.test(value) ? "failed" : "completed"); return <em className={`v2-status ${inferred}`}>{value}</em>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="v2-empty"><b>{title}</b>{detail}</div>; }
