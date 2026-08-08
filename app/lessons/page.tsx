"use client";

import Link from "@/app/components/HardNavigationLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ClassPicker } from "../components/ClassPicker";
import { EmptyState, MetricCard, Panel, StatusBadge } from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";

type Lesson = Record<string, any> & { id: number; date: string; courseName: string; stage: string; grade: string; status: string };
const statuses: Record<string, string> = { draft: "草稿", scheduled: "待上课", completed: "已完成", cancelled: "已取消", rescheduled: "已调课", makeup: "待补课" };
const statusTone = (status: string): "success" | "danger" | "warning" | "neutral" => status === "completed" ? "success" : status === "cancelled" ? "danger" : status === "scheduled" || status === "makeup" ? "warning" : "neutral";
const blank = () => ({ classId: "", date: new Date().toISOString().slice(0, 10), startTime: "", endTime: "", courseName: "思想政治辅导", stage: "高中", grade: "高一", mode: "offline", location: "", onlineLink: "", textbookVersion: "统编版", volume: "必修3 政治与法治", unit: "", topic: "", knowledgePoints: "", teachingGoals: "", keyPoints: "", difficultPoints: "", actualContent: "", materials: "", activities: "", homework: "", nextPlan: "", participation: "", understanding: "", completion: "", discipline: "", fee: "", feeStatus: "untracked", cancellationReason: "", status: "scheduled" });
const fields = Object.keys(blank());

export default function LessonsPage() {
  const [items, setItems] = useState<Lesson[]>([]), [form, setForm] = useState<Record<string, string>>(blank()), [open, setOpen] = useState(false), [editing, setEditing] = useState<number | null>(null), [searchInput, setSearchInput] = useState(""), [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [stage, setStage] = useState("all"), [classFilter, setClassFilter] = useState(""), [month, setMonth] = useState(new Date().toISOString().slice(0, 7)), [weekAnchor, setWeekAnchor] = useState(new Date().toISOString().slice(0, 10)), [view, setView] = useState("list"), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true), [lessonLoadError, setLessonLoadError] = useState(""), [reloadKey, setReloadKey] = useState(0), [submitting, setSubmitting] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLessonLoadError("");
    try {
      const params = new URLSearchParams({ q: query, status, classId: classFilter, from: month ? `${month}-01` : "", to: month ? `${month}-31` : "" });
      const lessonsData = await requestJson<{ lessons?: Lesson[] }>(`/api/lessons?${params}`, { signal });
      if (!lessonsData) throw new HttpError(200, "课时数据为空");
      setItems(lessonsData.lessons || []);
    } catch (reason) {
      if (!signal?.aborted) setLessonLoadError(reason instanceof HttpError ? reason.message : "暂时无法读取课时");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [query, status, classFilter, month]);
  const edit = (row?: Lesson) => { setEditing(row?.id || null); const next: Record<string, string> = blank(); if (row) for (const key of fields) next[key] = row[key] == null ? "" : String(row[key]); setForm(next); setOpen(true); };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, reloadKey]);
  useEffect(() => {
    const params = new URLSearchParams(location.search), id = params.get("edit"), classId = params.get("class"), initialStatus = params.get("status"), from = params.get("from");
    if (initialStatus) setStatus(initialStatus);
    if (classId) setClassFilter(classId);
    if (from) setMonth(from.slice(0, 7));
    if (params.get("focus") === "post") setView("list");
    if (id) void requestJson<{ lesson?: Lesson }>(`/api/lessons/${id}`).then((data) => data?.lesson && edit(data.lesson)).catch((reason) => setMessage(reason instanceof HttpError ? reason.message : "暂时无法读取课时详情"));
    else if (params.get("new") === "1") { const next = blank(); if (classId) next.classId = classId; setForm(next); setOpen(true); }
  }, []);
  const shown = useMemo(() => items.filter((item) => stage === "all" || item.stage === stage), [items, stage]);
  const save = async (nextStatus?: string) => {
    if (submitting) return;
    setSubmitting(true);
    setMessage("");
    try {
      const payload = { ...form, status: nextStatus || form.status };
      const data = await requestJson<{ lesson?: Lesson }>(editing ? `/api/lessons/${editing}` : "/api/lessons", { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!data?.lesson) throw new HttpError(200, "保存响应为空，请重试");
      setOpen(false);
      setEditing(null);
      setForm(blank());
      setMessage(`课时已${payload.status === "completed" ? "完成" : "保存"}`);
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(reason instanceof HttpError ? reason.message : "保存课时失败");
    } finally {
      setSubmitting(false);
    }
  };
  const remove = async (id: number) => {
    if (submitting) return;
    if (!confirm("确认删除这条课时记录？删除后不可恢复。")) return;
    setSubmitting(true);
    setMessage("");
    try {
      const data = await requestJson<{ ok?: boolean }>(`/api/lessons/${id}`, { method: "DELETE" });
      if (!data?.ok) throw new HttpError(200, "删除响应为空，请重试");
      setMessage("课时已删除");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(reason instanceof HttpError ? reason.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  };
  const duplicate = (row: Lesson) => { const copy = { ...row, id: 0, date: new Date().toISOString().slice(0, 10), status: "scheduled", cancellationReason: "" }; edit(copy); };
  const set = (key: string, value: string) => setForm({ ...form, [key]: value });
  const days = useMemo(() => { const [year, monthIndex] = month.split("-").map(Number), count = new Date(year, monthIndex, 0).getDate(), first = new Date(year, monthIndex - 1, 1).getDay(); return Array.from({ length: first + count }, (_, index) => index < first ? null : index - first + 1); }, [month]);
  const weekDays = useMemo(() => { const base = new Date(`${weekAnchor}T12:00:00`), monday = new Date(base); monday.setDate(base.getDate() - ((base.getDay() + 6) % 7)); return Array.from({ length: 7 }, (_, index) => { const value = new Date(monday); value.setDate(monday.getDate() + index); return value.toISOString().slice(0, 10); }); }, [weekAnchor]);
  const todayKey = new Date().toISOString().slice(0, 10);
  const completedCount = shown.filter((item) => item.status === "completed").length;
  const upcomingCount = shown.filter((item) => item.date >= todayKey && !["completed", "cancelled"].includes(item.status)).length;

  return <AppShell title="课时记录" subtitle="把每一节课的准备、进展与课后记录放在同一条教学轨迹上" actions={<button className="primaryButton" disabled={submitting} onClick={() => edit()}>＋ 新建课时</button>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    {loading && <div className="lessonLoading" role="status">正在整理课时记录…</div>}
    {lessonLoadError && <div className="lessonLoadError" role="alert"><div><strong>课时暂时没有读取成功</strong><p>{lessonLoadError}</p></div><button className="secondaryButton" onClick={() => setReloadKey((value) => value + 1)}>重新读取课时</button></div>}

    <div className="lessonMetricGrid">
      <MetricCard label="筛选结果" value={shown.length} detail="当前条件下的课时" />
      <MetricCard label="待上课" value={upcomingCount} detail="今天及之后的安排" />
      <MetricCard label="已完成" value={completedCount} detail="已留下教学记录" />
    </div>

    <Panel className="lessonFilterPanel" eyebrow="课时检索" title="找到需要处理的课" description="输入关键词后再搜索，避免每次输入都重复请求。">
      <form className="lessonToolbar" onSubmit={(event) => { event.preventDefault(); setQuery(searchInput.trim()); }}>
        <label className="lessonSearchField">关键词<input aria-label="搜索课时" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="课程、课题或单元" /></label>
        <button className="secondaryButton" type="submit">搜索</button>
        <ClassPicker includeAll label="班级" value={classFilter} onChange={setClassFilter} />
        <label>状态<select aria-label="筛选课时状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>学段<select aria-label="筛选学段" value={stage} onChange={(event) => setStage(event.target.value)}><option value="all">全部学段</option><option>初中</option><option>高中</option></select></label>
        <label>月份<input aria-label="筛选月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
      </form>
    </Panel>

    <div className="lessonViewSwitch" role="group" aria-label="课时视图">
      <button aria-pressed={view === "list"} onClick={() => setView("list")}>列表视图</button>
      <button aria-pressed={view === "week"} onClick={() => setView("week")}>周日历</button>
      <button aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>月日历</button>
      {view === "week" && <input aria-label="选择所在周" type="date" value={weekAnchor} onChange={(event) => { setWeekAnchor(event.target.value); setMonth(event.target.value.slice(0, 7)); }} />}
      <span>显示 {month || "全部月份"} 的课时</span>
    </div>

    {view === "week" ? <Panel className="weekCalendarPanel" eyebrow="一周安排" title="按天查看课时"><div className="weekCalendar">{weekDays.map((date, index) => <article key={date}><header><b>周{["一","二","三","四","五","六","日"][index]}</b><span>{date.slice(5)}</span></header>{shown.filter((item) => item.date === date).length ? shown.filter((item) => item.date === date).map((item) => <Link href={`/lessons/${item.id}`} key={item.id}><time>{item.startTime || "待定"}</time><b>{item.displaySubject || item.courseName}</b><StatusBadge tone={statusTone(item.status)}>{statuses[item.status] || item.status}</StatusBadge></Link>) : <p>无课时</p>}</article>)}</div></Panel> : view === "list" ? <Panel className="lessonListPanel" eyebrow="课程安排" title="课时列表" description="按日期查看状态、班级与授课方式。">{shown.length === 0 ? <EmptyState title="没有符合条件的课时" description="调整筛选条件，或创建一节真实课程。" action={<button className="secondaryButton" onClick={() => edit()}>新建第一节课</button>} /> : <div className="recordList">{shown.map((item) => <article key={item.id}><div className="dateBlock"><b>{item.date.slice(8)}</b><span>{item.date.slice(0, 7)}</span></div><div className="recordInfo"><StatusBadge tone={statusTone(item.status)}>{statuses[item.status] || item.status}</StatusBadge><h3><Link href={`/lessons/${item.id}`}>{item.displaySubject || item.courseName}</Link></h3><p>{String(item.startTime || "待定")}–{String(item.endTime || "待定")}　{item.grade}　{item.className || "未关联班级"}　{item.mode === "online" ? "线上" : String(item.location || "线下")}{item.topic ? `　课题：${item.topic}` : ""}</p></div><div className="rowActions"><Link href={`/lessons/${item.id}`}>详情</Link><button disabled={submitting} onClick={() => duplicate(item)}>复制</button><button disabled={submitting} onClick={() => edit(item)}>编辑</button><button disabled={submitting} onClick={() => remove(item.id)}>删除</button></div></article>)}</div>}</Panel> : <Panel className="lessonCalendarPanel" eyebrow="月度视图" title={month} description="点击课时进入详情；同一天的多节课会依次排列。"><div className="lessonCalendar"><div className="calendarWeek">{["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>周{day}</span>)}</div><div className="calendarGrid">{days.map((day, index) => day == null ? <i key={`blank-${index}`}></i> : <article key={day}><b>{day}</b>{shown.filter((item) => Number(item.date.slice(8)) === day).map((item) => <Link href={`/lessons/${item.id}`} key={item.id}>{item.startTime || "待定"} {item.displaySubject || item.courseName}</Link>)}</article>)}</div></div></Panel>}
    {open && <div className="modalBackdrop"><div className="lessonModal" role="dialog" aria-modal="true" aria-labelledby="lesson-title"><div className="modalTitle"><div><p>{editing ? "编辑课时" : "新建课时"}</p><h2 id="lesson-title">记录一节政治课</h2></div><button aria-label="关闭" disabled={submitting} onClick={() => setOpen(false)}>×</button></div><div className="formGrid"><label>日期<input type="date" value={form.date} onChange={(event) => set("date", event.target.value)} /></label><ClassPicker label="所属班级" value={form.classId} onChange={(value) => set("classId", value)} placeholder="暂不关联班级" /><label>开始时间<input type="time" value={form.startTime} onChange={(event) => set("startTime", event.target.value)} /></label><label>结束时间<input type="time" value={form.endTime} onChange={(event) => set("endTime", event.target.value)} /></label><label>状态<select value={form.status} onChange={(event) => set("status", event.target.value)}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>课程名称<input value={form.courseName} onChange={(event) => set("courseName", event.target.value)} /></label><label>授课方式<select value={form.mode} onChange={(event) => set("mode", event.target.value)}><option value="offline">线下</option><option value="online">线上</option></select></label><label>线下地点<input value={form.location} onChange={(event) => set("location", event.target.value)} /></label><label>线上链接<input value={form.onlineLink} onChange={(event) => set("onlineLink", event.target.value)} /></label><label>学段<select value={form.stage} onChange={(event) => set("stage", event.target.value)}><option>初中</option><option>高中</option></select></label><label>年级<select value={form.grade} onChange={(event) => set("grade", event.target.value)}>{["七年级", "八年级", "九年级", "高一", "高二", "高三"].map((item) => <option key={item}>{item}</option>)}</select></label><label>教材版本<input value={form.textbookVersion} onChange={(event) => set("textbookVersion", event.target.value)} /></label><label>册别/模块<input value={form.volume} onChange={(event) => set("volume", event.target.value)} /></label><label>单元<input value={form.unit} onChange={(event) => set("unit", event.target.value)} /></label><label>课题<input value={form.topic} onChange={(event) => set("topic", event.target.value)} /></label><label className="wide">知识点（仅填写已有目录或教师确认内容）<input value={form.knowledgePoints} onChange={(event) => set("knowledgePoints", event.target.value)} /></label><label>单节课费用（可选）<input type="number" min="0" value={form.fee} onChange={(event) => set("fee", event.target.value)} /></label><label>费用状态<select value={form.feeStatus} onChange={(event) => set("feeStatus", event.target.value)}><option value="untracked">不记录</option><option value="unpaid">待收</option><option value="paid">已收</option><option value="waived">免收</option></select></label>{form.status === "cancelled" && <label className="wide">取消原因<textarea value={form.cancellationReason} onChange={(event) => set("cancellationReason", event.target.value)} /></label>}<label className="wide">教学目标<textarea value={form.teachingGoals} onChange={(event) => set("teachingGoals", event.target.value)} /></label><label>教学重点<textarea value={form.keyPoints} onChange={(event) => set("keyPoints", event.target.value)} /></label><label>教学难点<textarea value={form.difficultPoints} onChange={(event) => set("difficultPoints", event.target.value)} /></label><label className="wide">实际教学内容<textarea value={form.actualContent} onChange={(event) => set("actualContent", event.target.value)} /></label><label>使用资料<textarea value={form.materials} onChange={(event) => set("materials", event.target.value)} /></label><label>课堂活动<textarea value={form.activities} onChange={(event) => set("activities", event.target.value)} /></label><label>布置作业<textarea value={form.homework} onChange={(event) => set("homework", event.target.value)} /></label><label>下次课计划<textarea value={form.nextPlan} onChange={(event) => set("nextPlan", event.target.value)} /></label><div className="wide ratingGrid">{[["participation", "参与度"], ["understanding", "理解度"], ["completion", "完成度"], ["discipline", "课堂纪律"]].map(([key, label]) => <label key={key}>{label}<select value={form[key]} onChange={(event) => set(key, event.target.value)}><option value="">待评</option>{[1, 2, 3, 4, 5].map((item) => <option key={item}>{item}</option>)}</select></label>)}</div></div><div className="modalActions"><button disabled={submitting} onClick={() => save("draft")}>{submitting ? "正在保存…" : "保存草稿"}</button><button className="primaryButton" disabled={submitting} onClick={() => save(form.status === "draft" ? "scheduled" : form.status)}>{submitting ? "正在保存…" : "保存课时"}</button><button className="secondaryButton" disabled={submitting} onClick={() => save("completed")}>{submitting ? "正在保存…" : "完成课时"}</button></div></div></div>}
  </AppShell>;
}
