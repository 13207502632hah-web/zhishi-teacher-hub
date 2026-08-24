"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "../../components/HardNavigationLink";
import { recognizeChineseImage } from "../../lib/local-ocr";

type Row = Record<string, unknown>;
export type OperationsTab = "assessments" | "exams" | "recognition" | "imports" | "calendar" | "academic";
type Tab = OperationsTab;
const labels: Array<[Tab, string]> = [["assessments", "测评"], ["exams", "考试项目"], ["recognition", "答题卡"], ["imports", "反馈解析"], ["calendar", "日历"], ["academic", "学年晋升"]];
const value = (input: unknown, fallback = "—") => String(input ?? "").trim() || fallback;
const count = (input: unknown) => Number(input || 0);

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(value(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function OperationsWorkspace({ initialTab = "assessments", initialAcademicYear = "", initialAssessmentClassId = "" }: { initialTab?: OperationsTab; initialAcademicYear?: string; initialAssessmentClassId?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [assessments, setAssessments] = useState<Row[]>([]), [projects, setProjects] = useState<Row[]>([]), [jobs, setJobs] = useState<Row[]>([]), [imports, setImports] = useState<Row[]>([]), [classes, setClasses] = useState<Row[]>([]), [students, setStudents] = useState<Row[]>([]), [papers, setPapers] = useState<Row[]>([]), [years, setYears] = useState<Row[]>([]);
  const [subscription, setSubscription] = useState<Row | null>(null), [feedUrl, setFeedUrl] = useState(""), [rotationArmed, setRotationArmed] = useState(false), [promotion, setPromotion] = useState<Row | null>(null), [promotionYear, setPromotionYear] = useState(initialAcademicYear), [excludedStudentIds, setExcludedStudentIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [a, p, r, i, c, studentData, paperData, y, cal] = await Promise.all([json("/api/v2/assessments"), json("/api/v2/exam-projects"), json("/api/v2/recognition"), json("/api/v2/feedback-imports"), json("/api/v2/classes?status=active&pageSize=200"), json("/api/v2/students?status=active&pageSize=200"), json("/api/v2/papers?status=all"), json("/api/v2/academic-years"), json("/api/v2/calendar/subscription")]);
      setAssessments((a.assessments || []) as Row[]); setProjects((p.projects || []) as Row[]); setJobs((r.jobs || []) as Row[]); setImports((i.imports || []) as Row[]); setClasses((c.classes || []) as Row[]); setStudents((studentData.students || []) as Row[]); setPapers((paperData.papers || []) as Row[]); setYears((y.academicYears || []) as Row[]); setSubscription((cal.subscription || null) as Row | null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "教学运营数据暂时无法读取"); }
    finally { setLoading(false); }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget, fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    try {
      if (tab === "assessments") await json("/api/v2/assessments", { method: "POST", body: JSON.stringify({ ...fields, classId: Number(fields.classId), paperId: fields.paperId ? Number(fields.paperId) : null, totalScore: Number(fields.totalScore), status: "draft" }) });
      else if (tab === "exams") { if (!window.confirm(`生成 ${fields.academicYear} 学年考试项目？重复执行只会补齐缺少项目，不会创建重复数据。`)) return; await json("/api/v2/exam-projects", { method: "POST", body: JSON.stringify(fields) }); }
      else if (tab === "imports") await json("/api/v2/feedback-imports", { method: "POST", body: JSON.stringify(fields) });
      form.reset(); setNotice(tab === "assessments" ? "测评草稿已建立。" : tab === "exams" ? "考试项目已按活跃年级生成。" : "反馈已解析为待核对草稿。"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const rotateCalendar = async () => {
    if (!rotationArmed) { setRotationArmed(true); return; }
    setBusy(true); setError("");
    try { const payload = await json("/api/v2/calendar/subscription", { method: "POST", body: "{}" }); setSubscription((payload.subscription || null) as Row | null); setFeedUrl(`${window.location.origin}${value(payload.path, "")}`); setRotationArmed(false); setNotice("新的私有订阅地址已生成；旧地址已立即停用。请现在复制，离开页面后不再显示。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "日历地址生成失败"); }
    finally { setBusy(false); }
  };

  const createRecognition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget, fields = new FormData(form), file = fields.get("answerCard");
    try {
      if (!(file instanceof File) || !file.size) throw new Error("请选择答题卡原图");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("答题卡仅支持 JPG、PNG 或 WebP 图片");
      if (file.size > 25 * 1024 * 1024) throw new Error("答题卡图片必须小于 25MB");
      const upload = new FormData(); upload.append("file", file); upload.append("purpose", "answer-card");
      const uploadResponse = await fetch("/api/v2/files", { method: "POST", body: upload }), uploaded = await uploadResponse.json().catch(() => ({})) as Row;
      if (!uploadResponse.ok || !uploaded.id) throw new Error(value(uploaded.error, `原图上传失败（${uploadResponse.status}）`));
      const operationId = crypto.randomUUID(), created = await json("/api/v2/recognition", { method: "POST", headers: { "X-Operation-Id": operationId }, body: JSON.stringify({ action: "create", operationId, assessmentId: Number(fields.get("assessmentId")), studentId: Number(fields.get("studentId")), sourceAssetId: Number(uploaded.id), items: [{ questionNumber: "1", studentAnswer: "", standardAnswer: "", teacherScore: null, maxScore: null, knowledgePoints: "", confidence: 0, candidates: [], errorType: "等待 AI 识别或人工校对", reviewStatus: "pending" }] }) });
      const id = Number(created.id); if (!id) throw new Error("校对任务已创建，但没有返回任务编号");
      router.push(`/v2/operations/recognition/${id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "答题卡任务创建失败"); }
    finally { setBusy(false); }
  };

  const previewPromotion = useCallback(async (year: string) => {
    setBusy(true); setError(""); setPromotion(null); setPromotionYear(year); setExcludedStudentIds([]);
    try { setPromotion(await json(`/api/v2/academic-years/${encodeURIComponent(year)}/promotion`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "晋升预览生成失败"); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (initialTab === "academic" && initialAcademicYear) void previewPromotion(initialAcademicYear); }, [initialAcademicYear, initialTab, previewPromotion]);

  const requestPromotionApproval = async () => {
    if (!promotion || !promotionYear) return;
    const summary = (promotion.summary || {}) as Row;
    setBusy(true); setError("");
    const eligible = Math.max(0, count(summary.affectedStudentCount) - excludedStudentIds.length);
    try { await json("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "academic_year.promote", entityType: "academic_year", entityId: promotionYear, title: `确认 ${promotionYear} 学年晋升`, summary: `将晋升 ${eligible} 名学生，教师排除 ${excludedStudentIds.length} 名；批准时会再次校验全部快照。`, payload: { academicYear: promotionYear, previewToken: promotion.previewToken, excludedStudentIds }, evidence: [{ type: "promotion_preview", academicYear: promotionYear, ...summary, excludedStudentIds, previewExpiresAt: promotion.previewExpiresAt }] }) }); setNotice("学年晋升已进入待确认中心；当前学生与班级尚未变更。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "晋升确认创建失败"); }
    finally { setBusy(false); }
  };

  const requestPromotionUndo = async () => {
    if (!promotion || !promotionYear) return; setBusy(true); setError("");
    try { await json(`/api/v2/academic-years/${encodeURIComponent(promotionYear)}/promotion/undo`, { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), reason: "主教师从学年晋升工作台申请安全撤销" }) }); setNotice("晋升撤销已进入待确认中心；批准并再次核对前不会修改学生年级。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "晋升撤销申请失败"); }
    finally { setBusy(false); }
  };

  return <><section className="v2-workspace-toolbar v2-operations-tabs"><div className="v2-tabs">{labels.map(([key, label]) => <button className={tab === key ? "active" : ""} onClick={() => { setTab(key); setNotice(""); setError(""); }} key={key}>{label}</button>)}</div><button onClick={() => void load()} disabled={loading}>↻ 刷新数据</button><small>所有正式成绩、日历密钥与晋升动作均有审计边界</small></section>{error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}<section className={`v2-card ${loading ? "v2-loading" : ""}`}>{tab === "assessments" && <AssessmentPanel rows={assessments} classes={classes} papers={papers} initialClassId={initialAssessmentClassId} submit={submit} busy={busy}/>} {tab === "exams" && <ExamPanel rows={projects} submit={submit} busy={busy}/>} {tab === "recognition" && <RecognitionPanel rows={jobs} assessments={assessments} students={students} create={createRecognition} busy={busy}/>} {tab === "imports" && <ImportPanel rows={imports} submit={submit} busy={busy}/>} {tab === "calendar" && <CalendarPanel subscription={subscription} feedUrl={feedUrl} armed={rotationArmed} busy={busy} rotate={rotateCalendar} cancel={() => setRotationArmed(false)}/>} {tab === "academic" && <AcademicPanel rows={years} promotion={promotion} excluded={excludedStudentIds} busy={busy} preview={previewPromotion} toggleExcluded={(studentId) => setExcludedStudentIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId])} requestApproval={requestPromotionApproval} requestUndo={requestPromotionUndo}/>}</section></>;
}

function AssessmentPanel({ rows, classes, papers, initialClassId, submit, busy }: { rows: Row[]; classes: Row[]; papers: Row[]; initialClassId: string; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [classFilter, setClassFilter] = useState(initialClassId), [statusFilter, setStatusFilter] = useState("all");
  const shown = useMemo(() => rows.filter((row) => (!classFilter || String(row.classId) === classFilter) && (statusFilter === "all" || value(row.status) === statusFilter)), [classFilter, rows, statusFilter]);
  return <div className="v2-ops-layout">
    <div>
      <Header title="测评与成绩证据" detail="新建内容默认是草稿，录入成绩后才进入学情分析。"/>
      <div className="v2-ops-filters">
        <label className="v2-ops-filter">班级<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="">全部班级</option>{classes.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.name)}</option>)}</select></label>
        <label className="v2-ops-filter">状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="completed">已完成</option></select></label>
        <Link className="v2-secondary-on-light" href="/api/v2/exports/assessments">导出全部成绩 CSV</Link>
      </div>
      <List rows={shown} icon="测" render={(row) => <><h3>{value(row.title)} <small>{value(row.className, "未关联班级")}</small></h3><p>{value(row.date)} · {value(row.type, "课堂测验")} · 总分 {value(row.totalScore, "100")}</p><span>{count(row.resultCount)} 份成绩 · 平均 {value(row.averageScore, "暂无")}{row.paperTitle ? ` · ${value(row.paperTitle)}` : ""}</span><Link className="v2-row-inline-button" href={`/v2/operations/assessments/${row.id}`}>录入与核对成绩</Link></>}/>
    </div>
    <form className="v2-form v2-inline-create" onSubmit={submit}>
      <h3>新建测评草稿</h3>
      <label>名称<input name="title" required/></label>
      <label>日期<input name="date" type="date" required/></label>
      <label>班级<select name="classId" defaultValue={initialClassId} required><option value="">请选择</option>{classes.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.name)}</option>)}</select></label>
      <label>类型<select name="type"><option>课堂测验</option><option>阶段测验</option><option>模拟考试</option></select></label>
      <label>总分<input name="totalScore" type="number" min="1" max="1000" defaultValue="100" required/></label>
      <label>关联试卷（可选）<select name="paperId"><option value="">暂不关联</option>{papers.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.title)}</option>)}</select></label>
      <label>备注<textarea name="notes" rows={3} placeholder="范围、目标或录入说明"/></label>
      <button className="v2-primary" disabled={busy}>{busy ? "保存中…" : "保存草稿"}</button>
    </form>
  </div>;
}
function ExamPanel({ rows, submit, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const years = [...new Set(rows.map((row) => value(row.academic_year, "")).filter(Boolean))], [yearFilter, setYearFilter] = useState("");
  const shown = yearFilter ? rows.filter((row) => value(row.academic_year) === yearFilter) : rows;
  return <div className="v2-ops-layout"><div><Header title="考试项目" detail="按活跃学生年级自动生成月考、期中、期末和毕业年级模拟考试。"/><label className="v2-ops-filter">查看学年<select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)}><option value="">全部学年</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label><List rows={shown} icon="考" render={(row) => <><h3>{value(row.name)} <small>{value(row.grade)}</small></h3><p>{value(row.academic_year)} · {value(row.category)} · {value(row.stage)}</p><span>{count(row.recordedCount)}/{count(row.studentCount)} 人已录入</span><Link className="v2-row-inline-button" href={`/v2/operations/exams/${row.id}`}>打开成绩表</Link></>}/></div><form className="v2-form v2-inline-create" onSubmit={submit}><h3>生成一个学年</h3><label>学年<input name="academicYear" required pattern="\d{4}-\d{4}" placeholder="2026-2027"/></label><p className="v2-form-note">只为当前活跃年级补齐模板；重复生成不会创建重复项目，也不会自动写入成绩。</p><button className="v2-primary" disabled={busy}>生成本学年模板</button></form></div>;
}
function RecognitionPanel({ rows, assessments, students, create, busy }: { rows: Row[]; assessments: Row[]; students: Row[]; create: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <div className="v2-ops-layout">
    <div>
      <Header title="答题卡识别与逐题校对" detail="低置信度、候选冲突和分值异常必须逐题人工确认；系统禁止按置信度一键确认。"/>
      <List rows={rows} icon="校" render={(row) => <><h3>{value(row.studentName, "未关联学生")} <small>{value(row.assessmentTitle, "未关联测评")}</small></h3><p>{value(row.sourceName)} · 识别器 {value(row.provider, "manual")}</p><span>阶段 {value(row.stage)} · 进度 {count(row.progress)}%</span><Link className="v2-row-inline-button" href={`/v2/operations/recognition/${row.id}`}>逐题校对</Link></>}/>
    </div>
    <form className="v2-form v2-inline-create" onSubmit={create}>
      <h3>新建答题卡任务</h3>
      <label>学生<select name="studentId" required><option value="">请选择学生</option>{students.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.name)} · {value(row.grade, "年级待补")}</option>)}</select></label>
      <label>测评<select name="assessmentId" required><option value="">请选择测评</option>{assessments.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.title)} · {value(row.className, "未关联班级")}</option>)}</select></label>
      <label className="v2-file-picker">答题卡原图<input name="answerCard" type="file" accept="image/jpeg,image/png,image/webp" required/><small>支持 JPG、PNG、WebP，最大 25MB；文件始终通过鉴权接口读取。</small></label>
      <label className="v2-review-check"><input name="ownershipConfirmed" type="checkbox" required/>我已核对学生与测评归属，确认保存这张原图</label>
      <p className="v2-form-note">创建后先进入逐题校对页。是否发送给外部视觉模型，会在下一步再次单独询问；未经确认不会调用外部 AI。</p>
      <button className="v2-primary" disabled={busy}>{busy ? "上传并创建中…" : "上传并创建校对任务"}</button>
    </form>
  </div>;
}
function ImportPanel({ rows, submit, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  const [sourceText, setSourceText] = useState(""), [ocrText, setOcrText] = useState(""), [sourceAssetId, setSourceAssetId] = useState(""), [ocrBusy, setOcrBusy] = useState(false), [progress, setProgress] = useState(0), [ocrError, setOcrError] = useState("");
  const hasUnsavedSource = Boolean(sourceText.trim() || ocrText.trim());
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (!hasUnsavedSource) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect); }, [hasUnsavedSource]);
  const recognize = async (file?: File) => {
    if (!file || busy || ocrBusy) return; setOcrError(""); setProgress(0);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setOcrError("反馈图片仅支持 JPG、PNG 或 WebP"); return; }
    if (file.size > 25 * 1024 * 1024) { setOcrError("反馈图片必须小于 25MB"); return; }
    setOcrBusy(true);
    try {
      const upload = new FormData(); upload.append("file", file); upload.append("purpose", "feedback-import");
      const [recognized, response] = await Promise.all([recognizeChineseImage(file, (item) => setProgress(Math.round(item.progress * 100))), fetch("/api/v2/files", { method: "POST", body: upload })]), stored = await response.json().catch(() => ({})) as Row;
      if (!response.ok || !stored.id) throw new Error(value(stored.error, `反馈原图保存失败（${response.status}）`));
      setSourceAssetId(String(stored.id)); setOcrText(recognized.text); if (!recognized.text) setOcrError("没有识别出文字，请换一张更清晰、方向正确的图片。");
    } catch (caught) { setOcrError(caught instanceof Error ? caught.message : "反馈图片识别失败，请改用粘贴文字"); }
    finally { setOcrBusy(false); }
  };
  const reset = () => { setSourceText(""); setOcrText(""); setSourceAssetId(""); setProgress(0); setOcrError(""); };
  return <div className="v2-ops-layout"><div><Header title="反馈反向解析" detail="把聊天记录或图片 OCR 文字还原为学生、日期、课时与反馈草稿。"/><List rows={rows} icon="析" render={(row) => <><h3>{value(row.sourceName, `解析任务 #${row.id}`)}</h3><p>置信度 {Math.round(Number(row.confidence || 0) * 100)}% · {value(row.status)}</p><span>{row.matched_lesson_id ? `已匹配课时 #${row.matched_lesson_id}` : "需要人工匹配课时"}</span><Link className="v2-row-inline-button" href={`/v2/operations/imports/${row.id}`}>核对解析草稿</Link></>}/></div><form className="v2-form v2-inline-create" onSubmit={submit} onReset={reset}><h3>提供待解析反馈</h3><label>反馈原文<textarea name="sourceText" rows={9} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="粘贴微信沟通、课后反馈或 OCR 文字…"/></label><label className="v2-file-picker">反馈图片（可选）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || ocrBusy} onChange={(event) => { void recognize(event.target.files?.[0]); event.target.value = ""; }}/><small>{ocrBusy ? `本机 OCR 识别中 ${progress}%` : "图片 OCR 只在当前浏览器运行；原图将保存为私有鉴权文件。"}</small></label>{ocrError && <p className="v2-alert v2-error">{ocrError}</p>}{ocrText && <label>核对 OCR 原文<textarea name="ocrTextEditor" rows={8} value={ocrText} onChange={(event) => setOcrText(event.target.value)}/></label>}<input type="hidden" name="ocrText" value={ocrText}/><input type="hidden" name="sourceAssetId" value={sourceAssetId}/><p className="v2-form-note">解析只建立可编辑草稿；低置信字段、学生归属和课时匹配必须在下一步人工核对。</p><button className="v2-primary" disabled={busy || ocrBusy || !hasUnsavedSource}>{busy ? "解析中…" : "解析为课时草稿"}</button></form></div>;
}
function CalendarPanel({ subscription, feedUrl, armed, busy, rotate, cancel }: { subscription: Row | null; feedUrl: string; armed: boolean; busy: boolean; rotate: () => void; cancel: () => void }) {
  const [addressSaved, setAddressSaved] = useState(false), [copyNotice, setCopyNotice] = useState("");
  const addressInput = useRef<HTMLInputElement>(null), webcalUrl = feedUrl.replace(/^https:/, "webcal:");
  useEffect(() => { setAddressSaved(false); setCopyNotice(""); }, [feedUrl]);
  useEffect(() => { const protect = (event: BeforeUnloadEvent) => { if (!feedUrl || addressSaved) return; event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", protect); return () => window.removeEventListener("beforeunload", protect); }, [addressSaved, feedUrl]);
  const copy = async () => { if (!feedUrl) return; try { await navigator.clipboard.writeText(feedUrl); setAddressSaved(true); setCopyNotice("订阅地址已复制，请勿转发给他人。"); } catch { addressInput.current?.focus(); addressInput.current?.select(); setCopyNotice("浏览器未能写入剪贴板，请手动选择并复制完整地址。"); } };
  const markSaved = () => { setAddressSaved(true); setCopyNotice("已打开添加或下载操作；该地址仍是私人凭据。"); };
  return <div className="v2-calendar-card"><Header title="Apple 日历订阅" detail="用于在 iPhone 或 Mac 日历中查看已确认课时；地址等同私密令牌，不可转发。"/><div className="v2-calendar-state"><span>历</span><div><h3>{subscription ? value(subscription.label, "Apple 日历") : "尚未建立订阅"}</h3><p>{subscription ? `建立于 ${value(subscription.createdAt)} · 默认提前 ${value(subscription.reminderMinutes, "30")} 分钟提醒` : "生成后可在 Apple 日历中添加"}</p></div><em className={`v2-status ${subscription ? "completed" : "warning"}`}>{subscription ? "已启用" : "未启用"}</em></div>{feedUrl && <div className="v2-calendar-address"><label className="v2-secret-once">仅显示一次<input ref={addressInput} readOnly value={feedUrl} onFocus={(event) => event.currentTarget.select()}/></label><div className="v2-inline-actions"><button className="v2-primary" disabled={busy} onClick={() => void copy()}>复制地址</button><a className="v2-secondary-on-light" href={webcalUrl} onClick={markSaved}>在 Apple 日历中打开</a><a className="v2-secondary-on-light" download="知师研室课程日历.ics" href={feedUrl} onClick={markSaved}>下载当前快照</a></div>{copyNotice && <p className="v2-alert">{copyNotice}</p>}<small>添加订阅会持续同步；下载的只是当前快照，后续课时调整不会自动更新。</small></div>}<div className="v2-inline-actions"><button className={armed ? "v2-danger-action" : "v2-primary"} disabled={busy} onClick={rotate}>{armed ? "再次点击：停用旧地址并生成新地址" : subscription ? "更换私有订阅地址" : "生成私有订阅地址"}</button>{armed && <button className="v2-secondary-on-light" onClick={cancel}>取消</button>}</div><ol className="v2-calendar-guide"><li><b>1</b><span>生成后复制地址，或直接点击“在 Apple 日历中打开”。</span></li><li><b>2</b><span>iPhone：设置 → App → 日历 → 日历账户 → 添加账户 → 其他 → 添加已订阅的日历。</span></li><li><b>3</b><span>保存后检查一节近期课时；课程调整会更新同一事件，不会重复创建。</span></li></ol></div>;
}
function AcademicPanel({ rows, promotion, excluded, busy, preview, toggleExcluded, requestApproval, requestUndo }: { rows: Row[]; promotion: Row | null; excluded: number[]; busy: boolean; preview: (year: string) => void; toggleExcluded: (studentId: number) => void; requestApproval: () => void; requestUndo: () => void }) {
  const summary = (promotion?.summary || {}) as Row, items = Array.isArray(promotion?.items) ? promotion.items as Row[] : [], skipped = Array.isArray(promotion?.skipped) ? promotion.skipped as Row[] : [], run = (promotion?.run || {}) as Row, runStatus = value(run.status), undoUntil = value(run.undo_until ?? run.undoUntil), undoAvailable = runStatus === "confirmed" && Boolean(undoUntil);
  return <><Header title="学年晋升" detail="先生成影响预览并锁定快照；正式确认前会再次检查学生年级和班级状态。"/><div className="v2-native-grid">{rows.map((row) => <article key={String(row.id)}><header><span>升</span><em className="v2-status completed">{value(row.status, "active")}</em></header><h3>{value(row.name)} 学年</h3><p>{value(row.startDate)} 至 {value(row.endDate)}</p><footer><span>{count(row.projectCount)} 个考试项目</span><span>{count(row.promotionRunCount)} 次晋升任务</span></footer><button className="v2-row-action" disabled={busy} onClick={() => void preview(value(row.name))}>查看晋升预览 / 状态</button></article>)}</div>{promotion && <section className="v2-promotion-preview"><h3>晋升影响快照</h3><div><b>{count(summary.affectedStudentCount)}</b><span>受影响学生</span><b>{count(summary.affectedClassCount)}</b><span>受影响班级</span><b>{count(summary.graduationCount)}</b><span>毕业</span><b>{count(summary.conflictCount)}</b><span>冲突</span></div><p>{runStatus === "confirmed" ? `本次晋升已确认。安全撤销截止 ${undoUntil || "未设置"}；服务端会在申请和批准时再次校验窗口与学生档案。` : runStatus === "undone" ? "本次晋升已经安全撤销，学生年级已恢复并保留完整审计记录。" : `预览有效至 ${value(promotion.previewExpiresAt, "重新生成前")}。批准时会再次比对学生、班级和报名关系；快照过期或有冲突会自动中止。本次共有 ${count(summary.skippedCount)} 个跳过项。`}</p><div className="v2-promotion-students">{items.map((item) => { const studentId = count(item.studentId), conflict = Boolean(item.conflict), checked = excluded.includes(studentId); return <label key={String(item.id)} className={conflict ? "conflict" : checked ? "excluded" : ""}><input type="checkbox" checked={checked} disabled={conflict || busy || runStatus !== "preview"} onChange={() => toggleExcluded(studentId)}/><span><b>{value(item.name, "学生记录已删除")}</b><small>{value(item.fromGrade)} → {value(item.toGrade)} · {value(item.classNames, "未关联班级")}</small></span><em>{value(item.status) === "undone" ? "已撤销" : conflict ? value(item.conflictReason, "数据冲突") : checked ? "本次排除" : value(item.action) === "graduate" ? "毕业" : "晋升"}</em></label>; })}</div>{skipped.length > 0 && <details className="v2-promotion-skipped"><summary>查看 {skipped.length} 个系统跳过项</summary>{skipped.map((item) => <p key={String(item.studentId)}><b>{value(item.name, "学生记录")}</b><span>{value(item.grade, "年级未填写")} · {value(item.reason, "没有可用晋升规则")}</span></p>)}</details>}{runStatus === "preview" ? <button className="v2-primary" disabled={busy || count(summary.conflictCount) > 0 || !promotion.previewToken || excluded.length >= items.length} onClick={requestApproval}>提交 {Math.max(0, items.length - excluded.length)} 人晋升到待确认中心</button> : runStatus === "confirmed" ? <button className="v2-danger-action" disabled={busy || !undoAvailable} onClick={requestUndo}>{undoAvailable ? "申请安全撤销本次晋升" : "没有可用的安全撤销窗口"}</button> : <em className="v2-status completed">{runStatus === "undone" ? "已安全撤销" : runStatus}</em>}</section>}</>;
}

function Header({ title, detail }: { title: string; detail: string }) { return <header className="v2-card-head"><div><h2>{title}</h2><p>{detail}</p></div></header>; }
function List({ rows, icon, render }: { rows: Row[]; icon: string; render: (row: Row) => React.ReactNode }) { return <div className="v2-native-list">{rows.map((row) => <article key={String(row.id)}><div className="v2-avatar">{icon}</div><div>{render(row)}</div><em className="v2-status completed">{value(row.status, value(row.stage, "已记录"))}</em></article>)}{!rows.length && <div className="v2-empty"><b>暂无记录</b>当前模块还没有业务数据。</div>}</div>; }
