"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "../../components/HardNavigationLink";

type Row = Record<string, unknown>;
type Tab = "assessments" | "exams" | "recognition" | "imports" | "calendar" | "academic";
const labels: Array<[Tab, string]> = [["assessments", "测评"], ["exams", "考试项目"], ["recognition", "答题卡"], ["imports", "反馈解析"], ["calendar", "日历"], ["academic", "学年晋升"]];
const value = (input: unknown, fallback = "—") => String(input ?? "").trim() || fallback;
const count = (input: unknown) => Number(input || 0);

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(value(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function OperationsWorkspace() {
  const [tab, setTab] = useState<Tab>("assessments"), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [assessments, setAssessments] = useState<Row[]>([]), [projects, setProjects] = useState<Row[]>([]), [jobs, setJobs] = useState<Row[]>([]), [imports, setImports] = useState<Row[]>([]), [classes, setClasses] = useState<Row[]>([]), [years, setYears] = useState<Row[]>([]);
  const [subscription, setSubscription] = useState<Row | null>(null), [feedUrl, setFeedUrl] = useState(""), [rotationArmed, setRotationArmed] = useState(false), [promotion, setPromotion] = useState<Row | null>(null), [promotionYear, setPromotionYear] = useState(""), [excludedStudentIds, setExcludedStudentIds] = useState<number[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [a, p, r, i, c, y, cal] = await Promise.all([json("/api/v2/assessments"), json("/api/v2/exam-projects"), json("/api/v2/recognition"), json("/api/v2/feedback-imports"), json("/api/v2/classes?status=active&pageSize=200"), json("/api/v2/academic-years"), json("/api/v2/calendar/subscription")]);
      setAssessments((a.assessments || []) as Row[]); setProjects((p.projects || []) as Row[]); setJobs((r.jobs || []) as Row[]); setImports((i.imports || []) as Row[]); setClasses((c.classes || []) as Row[]); setYears((y.academicYears || []) as Row[]); setSubscription((cal.subscription || null) as Row | null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "教学运营数据暂时无法读取"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget, fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    try {
      if (tab === "assessments") await json("/api/v2/assessments", { method: "POST", body: JSON.stringify({ ...fields, classId: Number(fields.classId), totalScore: Number(fields.totalScore), status: "draft" }) });
      else if (tab === "exams") await json("/api/v2/exam-projects", { method: "POST", body: JSON.stringify(fields) });
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

  const previewPromotion = async (year: string) => {
    setBusy(true); setError(""); setPromotion(null); setPromotionYear(year); setExcludedStudentIds([]);
    try { setPromotion(await json(`/api/v2/academic-years/${encodeURIComponent(year)}/promotion`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "晋升预览生成失败"); }
    finally { setBusy(false); }
  };

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

  return <><section className="v2-workspace-toolbar v2-operations-tabs"><div className="v2-tabs">{labels.map(([key, label]) => <button className={tab === key ? "active" : ""} onClick={() => { setTab(key); setNotice(""); setError(""); }} key={key}>{label}</button>)}</div><button onClick={() => void load()} disabled={loading}>↻ 刷新数据</button><small>所有正式成绩、日历密钥与晋升动作均有审计边界</small></section>{error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}<section className={`v2-card ${loading ? "v2-loading" : ""}`}>{tab === "assessments" && <AssessmentPanel rows={assessments} classes={classes} submit={submit} busy={busy}/>} {tab === "exams" && <ExamPanel rows={projects} submit={submit} busy={busy}/>} {tab === "recognition" && <RecognitionPanel rows={jobs}/>} {tab === "imports" && <ImportPanel rows={imports} submit={submit} busy={busy}/>} {tab === "calendar" && <CalendarPanel subscription={subscription} feedUrl={feedUrl} armed={rotationArmed} busy={busy} rotate={rotateCalendar} cancel={() => setRotationArmed(false)}/>} {tab === "academic" && <AcademicPanel rows={years} promotion={promotion} excluded={excludedStudentIds} busy={busy} preview={previewPromotion} toggleExcluded={(studentId) => setExcludedStudentIds((current) => current.includes(studentId) ? current.filter((id) => id !== studentId) : [...current, studentId])} requestApproval={requestPromotionApproval} requestUndo={requestPromotionUndo}/>}</section></>;
}

function AssessmentPanel({ rows, classes, submit, busy }: { rows: Row[]; classes: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <div className="v2-ops-layout"><div><Header title="测评与成绩证据" detail="新建内容默认是草稿，录入成绩后才进入学情分析。"/><List rows={rows} icon="测" render={(row) => <><h3>{value(row.title)} <small>{value(row.className, "未关联班级")}</small></h3><p>{value(row.date)} · {value(row.type, "课堂测验")} · 总分 {value(row.totalScore, "100")}</p><span>{count(row.resultCount)} 份成绩 · 平均 {value(row.averageScore, "暂无")}</span><Link className="v2-row-inline-button" href={`/v2/operations/assessments/${row.id}`}>录入与核对成绩</Link></>}/></div><form className="v2-form v2-inline-create" onSubmit={submit}><h3>新建测评草稿</h3><label>名称<input name="title" required/></label><label>日期<input name="date" type="date" required/></label><label>班级<select name="classId" required><option value="">请选择</option>{classes.map((row) => <option value={String(row.id)} key={String(row.id)}>{value(row.name)}</option>)}</select></label><label>类型<select name="type"><option>课堂测验</option><option>阶段测验</option><option>模拟考试</option></select></label><label>总分<input name="totalScore" type="number" min="1" max="1000" defaultValue="100" required/></label><button className="v2-primary" disabled={busy}>保存草稿</button></form></div>; }
function ExamPanel({ rows, submit, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <div className="v2-ops-layout"><div><Header title="考试项目" detail="按活跃学生年级自动生成月考、期中、期末和毕业年级模拟考试。"/><List rows={rows} icon="考" render={(row) => <><h3>{value(row.name)} <small>{value(row.grade)}</small></h3><p>{value(row.academic_year)} · {value(row.category)} · {value(row.stage)}</p><span>{count(row.recordedCount)}/{count(row.studentCount)} 人已录入</span><Link className="v2-row-inline-button" href={`/v2/operations/exams/${row.id}`}>打开成绩表</Link></>}/></div><form className="v2-form v2-inline-create" onSubmit={submit}><h3>生成一个学年</h3><label>学年<input name="academicYear" required pattern="\d{4}-\d{4}" placeholder="2026-2027"/></label><p className="v2-form-note">只为当前活跃年级生成项目，不会自动写入成绩。</p><button className="v2-primary" disabled={busy}>生成考试项目</button></form></div>; }
function RecognitionPanel({ rows }: { rows: Row[] }) { return <><Header title="答题卡识别与逐题校对" detail="低置信度、候选冲突和分值异常必须逐题人工确认；系统禁止按置信度一键确认。"/><List rows={rows} icon="校" render={(row) => <><h3>{value(row.studentName, "未关联学生")} <small>{value(row.assessmentTitle, "未关联测评")}</small></h3><p>{value(row.sourceName)} · 识别器 {value(row.provider, "manual")}</p><span>阶段 {value(row.stage)} · 进度 {count(row.progress)}%</span><Link className="v2-row-inline-button" href={`/v2/operations/recognition/${row.id}`}>逐题校对</Link></>}/></>; }
function ImportPanel({ rows, submit, busy }: { rows: Row[]; submit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) { return <div className="v2-ops-layout"><div><Header title="反馈反向解析" detail="把聊天记录或图片 OCR 文字还原为学生、日期、课时与反馈草稿。"/><List rows={rows} icon="析" render={(row) => <><h3>{value(row.sourceName, `解析任务 #${row.id}`)}</h3><p>置信度 {Math.round(Number(row.confidence || 0) * 100)}% · {value(row.status)}</p><span>{row.matched_lesson_id ? `已匹配课时 #${row.matched_lesson_id}` : "需要人工匹配课时"}</span><Link className="v2-row-inline-button" href={`/v2/operations/imports/${row.id}`}>核对解析草稿</Link></>}/></div><form className="v2-form v2-inline-create" onSubmit={submit}><h3>粘贴待解析反馈</h3><label>原始文字<textarea name="sourceText" rows={10} required placeholder="粘贴微信沟通、课后反馈或 OCR 文字…"/></label><button className="v2-primary" disabled={busy}>解析为草稿</button></form></div>; }
function CalendarPanel({ subscription, feedUrl, armed, busy, rotate, cancel }: { subscription: Row | null; feedUrl: string; armed: boolean; busy: boolean; rotate: () => void; cancel: () => void }) { return <div className="v2-calendar-card"><Header title="Apple 日历订阅" detail="用于在 iPhone 日历中查看课表；地址等同私密令牌，不可转发。"/><div className="v2-calendar-state"><span>历</span><div><h3>{subscription ? value(subscription.label, "Apple 日历") : "尚未建立订阅"}</h3><p>{subscription ? `建立于 ${value(subscription.createdAt)}` : "生成后可在 iPhone 的订阅日历中添加"}</p></div><em className={`v2-status ${subscription ? "completed" : "warning"}`}>{subscription ? "已启用" : "未启用"}</em></div>{feedUrl && <label className="v2-secret-once">仅显示一次<input readOnly value={feedUrl} onFocus={(event) => event.currentTarget.select()}/></label>}<button className={armed ? "v2-danger-action" : "v2-primary"} disabled={busy} onClick={rotate}>{armed ? "再次点击：停用旧地址并生成新地址" : subscription ? "更换私有订阅地址" : "生成私有订阅地址"}</button>{armed && <button className="v2-secondary-on-light" onClick={cancel}>取消</button>}</div>; }
function AcademicPanel({ rows, promotion, excluded, busy, preview, toggleExcluded, requestApproval, requestUndo }: { rows: Row[]; promotion: Row | null; excluded: number[]; busy: boolean; preview: (year: string) => void; toggleExcluded: (studentId: number) => void; requestApproval: () => void; requestUndo: () => void }) { const summary = (promotion?.summary || {}) as Row, items = Array.isArray(promotion?.items) ? promotion.items as Row[] : [], run = (promotion?.run || {}) as Row, runStatus = value(run.status), undoUntil = value(run.undo_until ?? run.undoUntil), undoAvailable = runStatus === "confirmed" && Boolean(undoUntil); return <><Header title="学年晋升" detail="先生成影响预览并锁定快照；正式确认前会再次检查学生年级和班级状态。"/><div className="v2-native-grid">{rows.map((row) => <article key={String(row.id)}><header><span>升</span><em className="v2-status completed">{value(row.status, "active")}</em></header><h3>{value(row.name)} 学年</h3><p>{value(row.startDate)} 至 {value(row.endDate)}</p><footer><span>{count(row.projectCount)} 个考试项目</span><span>{count(row.promotionRunCount)} 次晋升任务</span></footer><button className="v2-row-action" disabled={busy} onClick={() => void preview(value(row.name))}>查看晋升预览 / 状态</button></article>)}</div>{promotion && <section className="v2-promotion-preview"><h3>晋升影响快照</h3><div><b>{count(summary.affectedStudentCount)}</b><span>受影响学生</span><b>{count(summary.affectedClassCount)}</b><span>受影响班级</span><b>{count(summary.graduationCount)}</b><span>毕业</span><b>{count(summary.conflictCount)}</b><span>冲突</span></div><p>{runStatus === "confirmed" ? `本次晋升已确认。安全撤销截止 ${undoUntil || "未设置"}；服务端会在申请和批准时再次校验窗口与学生档案。` : runStatus === "undone" ? "本次晋升已经安全撤销，学生年级已恢复并保留完整审计记录。" : "批准时会再次比对学生、班级和报名关系；快照过期或有冲突会自动中止。勾选“本次排除”只影响本次审批，不修改学生档案。"}</p><div className="v2-promotion-students">{items.map((item) => { const studentId = count(item.studentId), conflict = Boolean(item.conflict), checked = excluded.includes(studentId); return <label key={String(item.id)} className={conflict ? "conflict" : checked ? "excluded" : ""}><input type="checkbox" checked={checked} disabled={conflict || busy || runStatus !== "preview"} onChange={() => toggleExcluded(studentId)}/><span><b>{value(item.name, "学生记录已删除")}</b><small>{value(item.fromGrade)} → {value(item.toGrade)} · {value(item.classNames, "未关联班级")}</small></span><em>{value(item.status) === "undone" ? "已撤销" : conflict ? value(item.conflictReason, "数据冲突") : checked ? "本次排除" : value(item.action) === "graduate" ? "毕业" : "晋升"}</em></label>; })}</div>{runStatus === "preview" ? <button className="v2-primary" disabled={busy || count(summary.conflictCount) > 0 || !promotion.previewToken || excluded.length >= items.length} onClick={requestApproval}>提交 {Math.max(0, items.length - excluded.length)} 人晋升到待确认中心</button> : runStatus === "confirmed" ? <button className="v2-danger-action" disabled={busy || !undoAvailable} onClick={requestUndo}>{undoAvailable ? "申请安全撤销本次晋升" : "没有可用的安全撤销窗口"}</button> : <em className="v2-status completed">{runStatus === "undone" ? "已安全撤销" : runStatus}</em>}</section>}</>; }

function Header({ title, detail }: { title: string; detail: string }) { return <header className="v2-card-head"><div><h2>{title}</h2><p>{detail}</p></div></header>; }
function List({ rows, icon, render }: { rows: Row[]; icon: string; render: (row: Row) => React.ReactNode }) { return <div className="v2-native-list">{rows.map((row) => <article key={String(row.id)}><div className="v2-avatar">{icon}</div><div>{render(row)}</div><em className="v2-status completed">{value(row.status, value(row.stage, "已记录"))}</em></article>)}{!rows.length && <div className="v2-empty"><b>暂无记录</b>当前模块还没有业务数据。</div>}</div>; }
