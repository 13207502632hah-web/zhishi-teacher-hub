"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "../../components/HardNavigationLink";
import { ClassPicker } from "../../components/ClassPicker";
import { requestJson } from "../../lib/http-client";
import styles from "./weekly-schedule.module.css";

type Lesson = { id: number; date: string; start_time: string; end_time: string; course_name: string; location: string; topic: string; status: string; isException: number; financeLocked: number; className?: string };
type Series = { id: string; name: string; start_date: string; end_date: string; weekday: number; count: number };
type Plan = { token: string; slots: Array<{ id: number; date: string; startTime: string; endTime: string; courseName: string; location: string; status: string }>; before: Array<{ id: number; date: string; startTime: string; endTime: string }>; skipped: Array<{ id: number; date: string; reason: string }>; conflicts: Array<{ id: number; date: string; courseName: string; startTime: string; endTime: string }> };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const blank = () => ({ kind: "create", courseName: "道德与法治", classId: "", stage: "初中", grade: "九年级", startDate: today(), endDate: "", weekday: "6", startTime: "09:00", endTime: "11:00", location: "", topic: "", date: "", lessonId: "", scope: "single", action: "reschedule", reason: "" });
const statusName: Record<string, string> = { scheduled: "待上课", rescheduled: "已调课", completed: "已完成", cancelled: "已停课", draft: "草稿", makeup: "待补课" };

export function WeeklyScheduleWorkspace() {
  const [series, setSeries] = useState<Series[]>([]), [selected, setSelected] = useState(""), [lessons, setLessons] = useState<Lesson[]>([]);
  const [form, setForm] = useState(blank), [plan, setPlan] = useState<Plan | null>(null), [operationId, setOperationId] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const load = useCallback(async (id = "") => {
    setLoading(true);
    try {
      const data = await requestJson<{ series: Series[]; selected: string; lessons: Lesson[] }>(`/api/v2/lesson-series?seriesId=${encodeURIComponent(id)}`);
      if (!data) throw new Error("课表返回为空");
      setSeries(data.series); setSelected(data.selected); setLessons(data.lessons);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法读取循环课表"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = (key: keyof ReturnType<typeof blank>, value: string) => { setForm((old) => ({ ...old, [key]: value })); setPlan(null); setError(""); setMessage(""); };
  const edit = (lesson: Lesson) => {
    setForm({ ...blank(), kind: "change", lessonId: String(lesson.id), date: lesson.date, courseName: lesson.course_name, startTime: lesson.start_time, endTime: lesson.end_time, location: lesson.location || "", topic: lesson.topic || "" });
    setPlan(null); setError(""); setMessage(""); document.getElementById("weekly-editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const preview = async () => {
    setBusy(true); setError(""); setPlan(null); setMessage("");
    try {
      const data = await requestJson<Plan>("/api/v2/lesson-series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, mode: "preview" }) });
      if (!data) throw new Error("预览返回为空");
      setPlan(data); setOperationId(crypto.randomUUID());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "预览失败"); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!plan || busy || plan.conflicts.length) return;
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ seriesId: string; count: number; skipped: number }>("/api/v2/lesson-series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, mode: "commit", previewToken: plan.token, operationId }) });
      if (!data) throw new Error("保存响应为空；请用同一确认按钮重试");
      setMessage(`${form.kind === "create" ? "已建立循环课表" : "课表已更新"}：${data.count} 节${data.skipped ? `，保留 ${data.skipped} 节原安排` : ""}。`);
      setPlan(null); setForm(blank()); await load(data.seriesId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试"); }
    finally { setBusy(false); }
  };
  return <div className={styles.workspace}>
    <header className={styles.heading}><div><h2>每周循环课表</h2><p>建立固定周课；临时调课只改一次，长期调整可应用到后续课次。</p></div><Link className="v2-secondary" href="/v2/modules/students?view=lessons&new=1">＋ 单独添加一节课</Link></header>
    {message && <p className={styles.success} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.layout}>
      <section id="weekly-editor" className={styles.panel} aria-label="循环课表编辑">
        <h3>{form.kind === "create" ? "新建循环课表" : "调课 / 改课 / 停课"}</h3>
        <fieldset disabled={busy} className={styles.fields}>
          {form.kind === "create" ? <>
            <label>起始日期<input type="date" value={form.startDate} onChange={(e) => change("startDate", e.target.value)} /></label>
            <label>结束日期<input type="date" min={form.startDate} value={form.endDate} onChange={(e) => change("endDate", e.target.value)} /></label>
            <label>每周上课日<select aria-label="每周上课日" value={form.weekday} onChange={(e) => change("weekday", e.target.value)}>{[1,2,3,4,5,6,0].map((n) => <option value={n} key={n}>星期{"日一二三四五六"[n]}</option>)}</select></label>
            <ClassPicker label="所属班级（可选）" value={form.classId} onChange={(value) => change("classId", value)} disabled={busy} allowClear />
            <label>学段<select aria-label="循环课表学段" value={form.stage} onChange={(e) => { change("stage", e.target.value); change("grade", e.target.value === "初中" ? "九年级" : "高一"); }}><option>初中</option><option>高中</option></select></label>
            <label>年级<select aria-label="循环课表年级" value={form.grade} onChange={(e) => change("grade", e.target.value)}>{(form.stage === "初中" ? ["七年级", "八年级", "九年级"] : ["高一", "高二", "高三"]).map((g) => <option key={g}>{g}</option>)}</select></label>
          </> : <>
            <label>调整范围<select aria-label="调整范围" value={form.scope} onChange={(e) => change("scope", e.target.value)}><option value="single">仅本次</option><option value="following">本次及后续课次</option></select></label>
            <label>操作<select aria-label="课表操作" value={form.action} onChange={(e) => change("action", e.target.value)}><option value="reschedule">调课 / 修改课程</option><option value="cancel">停课（保留记录）</option></select></label>
            {form.action !== "cancel" && <label>调整后日期<input type="date" value={form.date} onChange={(e) => change("date", e.target.value)} /></label>}
            <label className={styles.wide}>变更原因<input value={form.reason} maxLength={500} onChange={(e) => change("reason", e.target.value)} placeholder="例如：本周学校活动，顺延一天" /></label>
          </>}
          {(form.kind === "create" || form.action !== "cancel") && <>
            <label>课程名称<input value={form.courseName} maxLength={120} onChange={(e) => change("courseName", e.target.value)} /></label>
            <label>上课地点<input value={form.location} maxLength={200} onChange={(e) => change("location", e.target.value)} /></label>
            <label>开始时间<input type="time" value={form.startTime} onChange={(e) => change("startTime", e.target.value)} /></label>
            <label>结束时间<input type="time" value={form.endTime} onChange={(e) => change("endTime", e.target.value)} /></label>
            <label className={styles.wide}>课题（可选）<input value={form.topic} maxLength={500} onChange={(e) => change("topic", e.target.value)} /></label>
          </>}
        </fieldset>
        <p className={styles.note}>{form.kind === "create" ? "起止日期均包含在内，单份最多两年；节假日不会自动跳过，可按次停课。" : "后续调整会保留已完成、已停课、财务锁定及单独改动的课次。日期整体平移、课次数不变，末次可能跨出原结束日期；以预览为准。"}</p>
        <div className={styles.actions}><button className="v2-primary" disabled={busy} onClick={() => void preview()}>{busy ? "正在处理…" : "预览课次与冲突"}</button>{form.kind === "change" && <button disabled={busy} className="v2-secondary" onClick={() => { setForm(blank()); setPlan(null); setError(""); }}>返回新建</button>}</div>
        {plan && <section className={styles.preview} aria-label="课表变更预览"><h4>将{form.kind === "create" ? "新增" : form.action === "cancel" ? "停课" : "修改"} {plan.slots.length} 节，保留 {plan.skipped.length} 节</h4>
          {plan.conflicts.length > 0 && <div className={styles.error}><b>发现冲突，不能保存</b>{plan.conflicts.map((c, i) => <p key={`${c.id}-${i}`}>{c.date} {c.startTime}–{c.endTime} · {c.courseName}</p>)}</div>}
          <ol className={styles.previewList}>{plan.slots.map((slot, i) => { const old = plan.before.find((row) => row.id === slot.id); return <li key={i}>{old && <small>原：{old.date} {old.startTime}–{old.endTime}</small>}<b>{slot.date} {slot.startTime}–{slot.endTime}{slot.status === "cancelled" ? " · 停课" : ""}</b><span>{slot.courseName} · {slot.location || "地点待定"}</span></li>; })}</ol>
          {plan.skipped.length > 0 && <details><summary>查看保留的课次</summary>{plan.skipped.map((row) => <p key={row.id}>{row.date} · {row.reason}</p>)}</details>}
          <button className="v2-primary" disabled={busy || plan.conflicts.length > 0} onClick={() => void commit()}>{busy ? "正在保存…" : "确认保存以上安排"}</button>
        </section>}
      </section>
      <section className={styles.panel} aria-label="已有循环课表"><h3>已有循环课表</h3>
        <label className={styles.selector}>选择课表<select aria-label="选择循环课表" value={selected} disabled={busy || loading} onChange={(e) => void load(e.target.value)}>{!series.length && <option value="">暂无循环课表</option>}{series.map((s) => <option key={s.id} value={s.id}>{s.name} · 初始周{"日一二三四五六"[s.weekday]} · {s.count} 节</option>)}</select></label>
        {loading ? <p role="status">正在读取课表…</p> : !lessons.length ? <p>先在左侧设置固定周课，预览后确认创建。</p> : <ul className={styles.lessonList}>{lessons.map((lesson) => <li key={lesson.id}><div><b>{lesson.date}　{lesson.start_time}–{lesson.end_time}</b><p>{lesson.course_name} · {lesson.className || "独立课次"} · {lesson.location || "地点待定"}</p><small>{statusName[lesson.status] || lesson.status}{lesson.isException ? " · 单次调整" : ""}{lesson.financeLocked ? " · 财务锁定" : ""}</small></div><div className={styles.actions}><Link href={`/v2/detail/lessons/${lesson.id}`}>备课 / 课后记录</Link><button disabled={busy || lesson.financeLocked > 0 || ["completed", "cancelled"].includes(lesson.status)} onClick={() => edit(lesson)}>调课 / 改课</button></div></li>)}</ul>}
        <Link href="/v2/modules/students?view=lessons">在课时列表、周日历中查看全部安排 →</Link>
      </section>
    </div>
  </div>;
}
