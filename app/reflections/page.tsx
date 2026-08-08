"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell, EmptyState } from "../components/AppShell";
import { ClassPicker } from "../components/ClassPicker";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./reflections.module.css";

type ReflectionRow = {
  id: number;
  lessonId: number | null;
  date: string;
  tags: string | null;
  problemType: string | null;
  expectedVsActual: string | null;
  effectivePractices: string | null;
  difficulties: string | null;
  studentEvidence: string | null;
  nextAction: string | null;
  actionCompleted: boolean;
  reusableMaterial: string | null;
  isStrategy: boolean;
  isPrivate: boolean;
  lessonTopic?: string | null;
  courseName?: string | null;
  className?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type LessonRow = { id: number; date: string; topic?: string | null; courseName?: string | null };

type ReflectionForm = {
  lessonId: string;
  date: string;
  tags: string;
  problemType: string;
  expectedVsActual: string;
  effectivePractices: string;
  difficulties: string;
  studentEvidence: string;
  nextAction: string;
  actionCompleted: boolean;
  reusableMaterial: string;
  isStrategy: boolean;
};

type AiDraft = {
  problemType: string;
  tags: string;
  expectedVsActual: string;
  effectivePractices: string;
  difficulties: string;
  studentEvidence: string;
  nextAction: string;
  reusableMaterial: string;
  evidenceSummary: string[];
  uncertainty: string[];
};

type AiMeta = { sentFields: string[]; excludedFields: string[] };
type DraftField = keyof Pick<AiDraft, "problemType" | "tags" | "expectedVsActual" | "effectivePractices" | "difficulties" | "studentEvidence" | "nextAction" | "reusableMaterial">;

const problemTypes = ["课堂节奏", "知识理解", "材料分析", "规范表达", "课堂参与", "作业落实", "价值引领", "其他"];
const draftFields: DraftField[] = ["problemType", "tags", "expectedVsActual", "effectivePractices", "difficulties", "studentEvidence", "nextAction", "reusableMaterial"];
const draftPreviewFields: Array<[DraftField, string]> = [
  ["problemType", "问题类型"],
  ["tags", "主题标签"],
  ["expectedVsActual", "预设与实际差异"],
  ["effectivePractices", "有效做法"],
  ["difficulties", "困难与原因"],
  ["studentEvidence", "学生反馈证据"],
  ["nextAction", "下一次可执行改进动作"],
  ["reusableMaterial", "可复用素材 / 话术 / 活动设计"],
];

const blank = (): ReflectionForm => ({
  lessonId: "",
  date: new Date().toISOString().slice(0, 10),
  tags: "",
  problemType: "",
  expectedVsActual: "",
  effectivePractices: "",
  difficulties: "",
  studentEvidence: "",
  nextAction: "",
  actionCompleted: false,
  reusableMaterial: "",
  isStrategy: false,
});

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value));
const nonEmpty = (value: unknown) => text(value).trim();
const errorMessage = (reason: unknown, fallback: string) => reason instanceof HttpError || reason instanceof Error ? reason.message : fallback;

const toForm = (row?: ReflectionRow, lessonIdOverride?: string): ReflectionForm => ({
  lessonId: lessonIdOverride ?? (row?.lessonId ? String(row.lessonId) : ""),
  date: row?.date || new Date().toISOString().slice(0, 10),
  tags: text(row?.tags),
  problemType: text(row?.problemType),
  expectedVsActual: text(row?.expectedVsActual),
  effectivePractices: text(row?.effectivePractices),
  difficulties: text(row?.difficulties),
  studentEvidence: text(row?.studentEvidence),
  nextAction: text(row?.nextAction),
  actionCompleted: Boolean(row?.actionCompleted),
  reusableMaterial: text(row?.reusableMaterial),
  isStrategy: Boolean(row?.isStrategy),
});

const toPayload = (value: ReflectionForm | ReflectionRow, isStrategy?: boolean) => ({
  lessonId: text(value.lessonId),
  date: text(value.date),
  tags: text(value.tags),
  problemType: text(value.problemType),
  expectedVsActual: text(value.expectedVsActual),
  effectivePractices: text(value.effectivePractices),
  difficulties: text(value.difficulties),
  studentEvidence: text(value.studentEvidence),
  nextAction: text(value.nextAction),
  actionCompleted: Boolean(value.actionCompleted),
  reusableMaterial: text(value.reusableMaterial),
  isStrategy: isStrategy ?? Boolean(value.isStrategy),
});

const toAiDraft = (value: unknown): AiDraft | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const draft = {
    problemType: text(row.problemType),
    tags: text(row.tags),
    expectedVsActual: text(row.expectedVsActual),
    effectivePractices: text(row.effectivePractices),
    difficulties: text(row.difficulties),
    studentEvidence: text(row.studentEvidence),
    nextAction: text(row.nextAction),
    reusableMaterial: text(row.reusableMaterial),
    evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary.map(text).filter(Boolean).slice(0, 20) : [],
    uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty.map(text).filter(Boolean).slice(0, 20) : [],
  };
  return draftFields.some((field) => nonEmpty(draft[field])) ? draft : null;
};

export default function ReflectionsPage() {
  const [rows, setRows] = useState<ReflectionRow[]>([]);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [month, setMonth] = useState("");
  const [topic, setTopic] = useState("");
  const [problemType, setProblemType] = useState("");
  const [classId, setClassId] = useState("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [reflectionLoading, setReflectionLoading] = useState(true);
  const [reflectionLoadError, setReflectionLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<ReflectionForm>(blank);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [editorError, setEditorError] = useState("");

  const [selectedDetail, setSelectedDetail] = useState<ReflectionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState("");

  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiMeta, setAiMeta] = useState<AiMeta | null>(null);

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const detailRequestRef = useRef(0);

  const formSnapshot = useMemo(() => JSON.stringify(form), [form]);
  const formDirty = open && (formSnapshot !== savedSnapshot || Boolean(aiDraft));

  const load = useCallback(async (signal?: AbortSignal) => {
    setReflectionLoading(true);
    setReflectionLoadError("");
    try {
      const query = new URLSearchParams({ q, tag, month, topic, problemType, classId });
      const [reflectionData, lessonData] = await Promise.all([
        requestJson<{ reflections?: ReflectionRow[] }>(`/api/reflections?${query.toString()}`, { signal }),
        requestJson<{ lessons?: LessonRow[] }>("/api/lessons", { signal }),
      ]);
      if (!reflectionData || !lessonData) throw new HttpError(200, "反思或关联数据为空，请重试");
      setRows(reflectionData.reflections || []);
      setLessons(lessonData.lessons || []);
    } catch (reason) {
      if (!signal?.aborted) setReflectionLoadError(errorMessage(reason, "暂时无法读取教学反思，请稍后重试"));
    } finally {
      if (!signal?.aborted) setReflectionLoading(false);
    }
  }, [classId, month, problemType, q, tag, topic]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const finishEditor = useCallback(() => {
    setOpen(false);
    setEditing(null);
    setForm(blank());
    setSavedSnapshot("");
    setAiDraft(null);
    setAiMeta(null);
    setAiError("");
    setEditorError("");
    window.setTimeout(() => previousFocusRef.current?.focus(), 0);
  }, []);

  const openEditor = useCallback((row?: ReflectionRow, lessonIdOverride?: string) => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next = toForm(row, lessonIdOverride);
    setEditing(row?.id ?? null);
    setForm(next);
    setSavedSnapshot(JSON.stringify(next));
    setAiDraft(null);
    setAiMeta(null);
    setAiError("");
    setEditorError("");
    setMessage("");
    setOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    if (mutationBusy || aiBusy) return;
    if (formDirty && !window.confirm("当前有未保存内容，关闭后将丢失。确认关闭编辑窗口？")) return;
    finishEditor();
  }, [aiBusy, finishEditor, formDirty, mutationBusy]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const lessonId = params.get("lesson");
    if (lessonId || params.get("new") === "1") openEditor(undefined, lessonId || undefined);
  }, [openEditor]);

  useEffect(() => {
    if (!open) return;
    const focusables = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") || []);
    const focusFirst = () => (focusables()[0] || dialogRef.current)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dialogRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key === "Tab") {
        const elements = focusables();
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const frame = window.requestAnimationFrame(focusFirst);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeEditor, open]);

  useEffect(() => {
    if (!open || !formDirty) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [formDirty, open]);

  const setField = <Key extends keyof ReflectionForm>(key: Key, value: ReflectionForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (mutationBusy) return;
    if (!nonEmpty(form.date)) {
      setEditorError("请先填写反思日期");
      return;
    }
    setMutationBusy(true);
    setEditorError("");
    setMessage("");
    try {
      const result = await requestJson<{ reflection?: ReflectionRow }>(editing ? `/api/reflections/${editing}` : "/api/reflections", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form)),
      });
      if (!result?.reflection) throw new HttpError(200, "保存响应为空，请重试");
      if (selectedDetail?.id === result.reflection.id) setSelectedDetail(result.reflection);
      finishEditor();
      setMessage("反思已私密保存");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setEditorError(errorMessage(reason, "保存失败，请检查日期和内容后重试"));
    } finally {
      setMutationBusy(false);
    }
  };

  const openDetail = async (row: ReflectionRow) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setSelectedDetail(row);
    setDetailLoading(true);
    setDetailLoadError("");
    try {
      const result = await requestJson<{ reflection?: ReflectionRow }>(`/api/reflections/${row.id}`);
      if (!result?.reflection) throw new HttpError(200, "详情响应为空，请重试");
      if (detailRequestRef.current === requestId) setSelectedDetail(result.reflection);
    } catch (reason) {
      if (detailRequestRef.current === requestId) setDetailLoadError(errorMessage(reason, "暂时无法读取这条反思详情"));
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  };

  const remove = async (id: number) => {
    if (mutationBusy) return;
    if (!window.confirm("确认删除这条私密反思？删除后不可恢复。")) return;
    setMutationBusy(true);
    setMessage("");
    try {
      const result = await requestJson<{ ok?: boolean }>(`/api/reflections/${id}`, { method: "DELETE" });
      if (!result?.ok) throw new HttpError(200, "删除响应为空，请重试");
      if (selectedDetail?.id === id) setSelectedDetail(null);
      setMessage("反思已删除");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(errorMessage(reason, "删除失败，请稍后重试"));
    } finally {
      setMutationBusy(false);
    }
  };

  const promote = async (row: ReflectionRow) => {
    if (mutationBusy) return;
    const evidence = [row.effectivePractices, row.nextAction, row.reusableMaterial].map(nonEmpty).filter(Boolean);
    if (!evidence.length) {
      setMessage("至少记录有效做法、改进动作或可复用素材后才能沉淀");
      return;
    }
    if (!window.confirm("教师明确选择：将这条真实反思中的有效做法、改进动作和可复用素材保存为私密教学策略？")) return;
    setMutationBusy(true);
    setMessage("");
    let resourceId = 0;
    try {
      const resource = await requestJson<{ resource?: { id?: number } }>("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `教学策略 · ${row.date} · ${row.lessonTopic || "课堂复盘"}`,
          type: "教学策略",
          tags: text(row.tags),
          content: evidence.join("\n\n"),
          sourceRef: `reflection:${row.id}`,
          visibility: "private",
        }),
      });
      resourceId = Number(resource?.resource?.id || 0);
      if (!resourceId) throw new HttpError(200, "策略资源保存响应为空，请重试");
      const updated = await requestJson<{ reflection?: ReflectionRow }>(`/api/reflections/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(row, true)),
      });
      if (!updated?.reflection) throw new HttpError(200, "反思状态更新响应为空，请重试");
      setRows((current) => current.map((item) => item.id === row.id ? updated.reflection as ReflectionRow : item));
      if (selectedDetail?.id === row.id) setSelectedDetail(updated.reflection);
      setMessage("已将真实反思沉淀为私密教学策略");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      if (resourceId) await requestJson(`/api/resources/${resourceId}`, { method: "DELETE" }).catch(() => undefined);
      setMessage(`${errorMessage(reason, "策略沉淀失败，请稍后重试")} 未完成的资源已尝试回收。`);
    } finally {
      setMutationBusy(false);
    }
  };

  const generateAiReflection = async () => {
    if (aiBusy) return;
    if (!nonEmpty(form.lessonId)) {
      setAiError("请先关联一节真实课时，再生成 AI 反思草案");
      return;
    }
    setAiBusy(true);
    setAiError("");
    setMessage("");
    try {
      const result = await requestJson<{ draft?: unknown; sentFields?: string[]; excludedFields?: string[] }>("/api/ai/reflection-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: Number(form.lessonId) }),
      });
      const draft = toAiDraft(result?.draft);
      if (!draft) throw new HttpError(200, "AI 草稿响应为空或结构无效，未采用任何内容");
      setAiDraft(draft);
      setAiMeta({ sentFields: result?.sentFields || [], excludedFields: result?.excludedFields || [] });
      setMessage("AI 反思草稿已生成；尚未保存、发布或覆盖教师文字");
    } catch (reason) {
      setAiError(errorMessage(reason, "AI 暂时不可用，请稍后重试或手动填写"));
    } finally {
      setAiBusy(false);
    }
  };

  const applyAiDraft = () => {
    if (!aiDraft) return;
    let appliedCount = 0;
    const next = { ...form };
    for (const key of draftFields) {
      if (!String(form[key] || "").trim()) {
        if (nonEmpty(aiDraft[key])) {
          next[key] = aiDraft[key];
          appliedCount += 1;
        }
      }
    }
    setForm(next);
    setMessage(appliedCount ? `草稿已补入 ${appliedCount} 个空白字段；已有教师文字保持不变` : "已有教师文字保持不变，没有可补入的空白字段");
  };

  const discardAiDraft = () => {
    setAiDraft(null);
    setAiMeta(null);
    setAiError("");
    setMessage("AI 草稿已丢弃，教师文字未改变");
  };

  const changeReflectionLesson = (lessonId: string) => {
    if (aiDraft && !window.confirm("切换关联课时会清空当前 AI 草稿，但不会删除或覆盖教师文字。确认切换？")) return;
    setField("lessonId", lessonId);
    if (aiDraft) {
      setAiDraft(null);
      setAiMeta(null);
      setAiError("");
      setMessage("关联课时已改变，旧 AI 反思草案已清空；请重新生成或手动填写");
    }
  };

  const calendarMonth = month || new Date().toISOString().slice(0, 7);
  const calendar = useMemo(() => {
    const [year, monthIndex] = calendarMonth.split("-").map(Number);
    const first = new Date(year, monthIndex - 1, 1);
    const count = new Date(year, monthIndex, 0).getDate();
    return { offset: (first.getDay() + 6) % 7, days: Array.from({ length: count }, (_, index) => `${calendarMonth}-${String(index + 1).padStart(2, "0")}`) };
  }, [calendarMonth]);

  const recurringProblems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = nonEmpty(row.problemType);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const strategies = useMemo(() => rows.filter((row) => row.isStrategy && [row.effectivePractices, row.nextAction, row.reusableMaterial].some(nonEmpty)), [rows]);
  const selectedEvidence = selectedDetail ? [selectedDetail.effectivePractices, selectedDetail.nextAction, selectedDetail.reusableMaterial].map(nonEmpty).filter(Boolean) : [];

  return (
    <AppShell title="教学反思" subtitle="默认私密的教学复盘与策略沉淀" actions={<button className={styles.primaryButton} type="button" disabled={mutationBusy} onClick={() => openEditor()}>＋ 新建反思</button>}>
      <div className={styles.page}>
        {message && <div className={styles.statusMessage} role="status">{message}</div>}

        <header className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>课后教研 · 私密工作区</p>
            <h2>把一节真实课，变成下一次可执行的改进。</h2>
            <p>反思记录、改进动作、可复用策略和 AI 草稿各自归位。没有真实记录时，这里不会补写重复问题或策略结论。</p>
          </div>
          <div className={styles.privacyCard}>
            <strong>隐私与 AI 边界</strong>
            <span>反思默认私密；AI 只根据已确认的真实课时记录生成草稿，不会自动保存、发布或覆盖教师文字。</span>
          </div>
        </header>

        <section className={styles.filterPanel} aria-labelledby="reflection-list-title">
          <div className={styles.sectionHeader}>
            <div><p className={styles.eyebrow}>反思列表</p><h2 id="reflection-list-title">找到需要继续处理的课后记录</h2></div>
            <button className={styles.secondaryButton} type="button" disabled={reflectionLoading} onClick={() => setReloadKey((value) => value + 1)}>重新读取</button>
          </div>
          <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setReloadKey((value) => value + 1); }}>
            <label>全文搜索<input value={q} onChange={(event) => setQ(event.target.value)} placeholder="做法、困难、证据或改进动作" /></label>
            <label>主题标签<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="如：材料分析" /></label>
            <label>课题<input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="按真实课时课题筛选" /></label>
            <ClassPicker includeAll label="班级" value={classId} onChange={setClassId} />
            <label>问题类型<select value={problemType} onChange={(event) => setProblemType(event.target.value)}><option value="">全部问题类型</option>{problemTypes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            <label>月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
            <button className={styles.filterButton} type="submit">应用筛选</button>
          </form>
          <div className={styles.viewSwitch} role="group" aria-label="反思列表视图">
            <button type="button" aria-pressed={view === "list"} className={view === "list" ? styles.activeTab : ""} onClick={() => setView("list")}>列表</button>
            <button type="button" aria-pressed={view === "calendar"} className={view === "calendar" ? styles.activeTab : ""} onClick={() => setView("calendar")}>日历</button>
          </div>
        </section>

        {reflectionLoading && <div className={styles.loadingState} role="status">正在读取真实反思记录…</div>}
        {reflectionLoadError && <div className={styles.errorState} role="alert"><div><strong>反思列表暂时没有读取成功</strong><p>{reflectionLoadError}</p></div><button className={styles.secondaryButton} type="button" onClick={() => setReloadKey((value) => value + 1)}>重新读取反思</button></div>}

        <div className={styles.contentGrid}>
          <div>
            {view === "calendar" ? (
              <section className={styles.calendarPanel} aria-labelledby="calendar-title">
                <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>反思列表</p><h2 id="calendar-title">{calendarMonth} 日历</h2></div><span className={styles.muted}>日历只显示已有记录摘要</span></div>
                {rows.length === 0 && !reflectionLoading && <p className={styles.noEvidence}>当前月份没有真实反思记录，不显示虚构内容。</p>}
                <div className={styles.calendarWeek}>{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>周{day}</span>)}</div>
                <div className={styles.calendarGrid}>{Array.from({ length: calendar.offset }, (_, index) => <i key={`blank-${index}`} aria-hidden="true" />)}{calendar.days.map((date) => { const items = rows.filter((row) => row.date === date); return <article key={date}><b>{Number(date.slice(-2))}</b>{items.slice(0, 2).map((item) => <button type="button" key={item.id} onClick={() => void openDetail(item)}>{item.lessonTopic || item.problemType || "教学反思"}</button>)}{items.length > 2 && <small>另 {items.length - 2} 条</small>}</article>; })}</div>
              </section>
            ) : (
              <section className={styles.listPanel} aria-labelledby="list-title">
                <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>反思列表</p><h2 id="list-title">真实课后记录</h2></div><span className={styles.muted}>{rows.length} 条当前筛选记录</span></div>
                {!reflectionLoading && !reflectionLoadError && rows.length === 0 ? <div className={styles.emptyWrap}><EmptyState title="还没有教学反思" description="完成一节真实课后，记录预设与实际差异、有效做法和下一次动作。这里不会填充虚构反思或策略。" action={<button className={styles.secondaryButton} type="button" onClick={() => openEditor()}>记录第一条反思</button>} /></div> : <div className={styles.recordList}>{rows.map((item) => <article className={styles.recordCard} key={item.id}>
                  <div className={styles.recordTop}><time dateTime={item.date}>{item.date}</time><span className={styles.privateBadge}>私密</span>{item.problemType && <span className={styles.topicBadge}>{item.problemType}</span>}{item.isStrategy && <span className={styles.strategyBadge}>已沉淀策略</span>}{item.actionCompleted && <span className={styles.doneBadge}>动作已完成</span>}</div>
                  <h3>{item.lessonTopic || item.courseName || "独立教学反思"}</h3>
                  <p className={styles.recordMeta}>{item.className || "未关联班级"}{item.tags ? ` · ${item.tags}` : ""}</p>
                  <div className={styles.previewGrid}><div><span>有效做法</span><p>{item.effectivePractices || "尚未填写"}</p></div><div><span>困难与原因</span><p>{item.difficulties || "尚未填写"}</p></div><div><span>改进动作</span><p>{item.nextAction || "尚未填写"}</p></div></div>
                  <div className={styles.cardActions}><button className={styles.primarySmallButton} type="button" disabled={mutationBusy} onClick={() => void openDetail(item)}>查看详情</button><button type="button" disabled={mutationBusy} onClick={() => openEditor(item)}>编辑</button><button type="button" disabled={mutationBusy || item.isStrategy} onClick={() => void promote(item)}>{item.isStrategy ? "已沉淀" : "沉淀为策略"}</button><button className={styles.dangerButton} type="button" disabled={mutationBusy} onClick={() => void remove(item.id)}>删除</button></div>
                </article>)}</div>}
              </section>
            )}
          </div>

          <aside className={styles.detailPanel} aria-label="反思详情">
            <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>反思详情</p><h2>{selectedDetail ? selectedDetail.lessonTopic || selectedDetail.courseName || "独立教学反思" : "选择一条记录"}</h2></div>{selectedDetail && <button type="button" className={styles.iconButton} aria-label="关闭反思详情" onClick={() => setSelectedDetail(null)}>×</button>}</div>
            {!selectedDetail && <p className={styles.detailPlaceholder}>从列表打开一条反思，查看完整证据、改进动作和策略沉淀依据。</p>}
            {selectedDetail && detailLoading && <p className={styles.loadingState} role="status">正在读取详情…</p>}
            {selectedDetail && detailLoadError && <div className={styles.errorState} role="alert"><p>{detailLoadError}</p><button className={styles.secondaryButton} type="button" onClick={() => void openDetail(selectedDetail)}>重试加载详情</button></div>}
            {selectedDetail && !detailLoading && <div className={styles.detailContent}>
              <div className={styles.detailMeta}><span>{selectedDetail.date}</span><span>{selectedDetail.className || "未关联班级"}</span><span>{selectedDetail.isPrivate ? "私密" : "请核对可见范围"}</span></div>
              {[["预设与实际差异", selectedDetail.expectedVsActual], ["有效做法", selectedDetail.effectivePractices], ["困难与原因", selectedDetail.difficulties], ["学生反馈证据", selectedDetail.studentEvidence], ["下一次可执行改进动作", selectedDetail.nextAction], ["可复用素材 / 话术 / 活动设计", selectedDetail.reusableMaterial]].map(([label, value]) => <section key={label as string}><h3>{label}</h3><p>{value || "尚未填写"}</p></section>)}
              <div className={styles.detailActions}><button className={styles.primarySmallButton} type="button" disabled={mutationBusy} onClick={() => openEditor(selectedDetail)}>编辑这条反思</button><button type="button" disabled={mutationBusy || selectedDetail.isStrategy || !selectedEvidence.length} onClick={() => void promote(selectedDetail)}>{selectedDetail.isStrategy ? "已沉淀为策略" : "沉淀为策略"}</button></div>
            </div>}
          </aside>
        </div>

        <section className={styles.evidencePanel} aria-labelledby="evidence-title">
          <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>来自当前列表真实记录</p><h2 id="evidence-title">改进动作与可复用策略</h2></div><span className={styles.muted}>只呈现已有反思支持的信号</span></div>
          <div className={styles.evidenceGrid}>
            <article><h3>重复问题</h3>{recurringProblems.length ? <ul>{recurringProblems.map(([name, count]) => <li key={name}><strong>{name}</strong><span>{count} 条真实反思记录</span></li>)}</ul> : <p className={styles.noEvidence}>当前记录尚未形成重复问题信号；至少有两条同类反思后才会显示。</p>}</article>
            <article><h3>有效策略</h3>{strategies.length ? <ul>{strategies.map((item) => <li key={item.id}><strong>{item.lessonTopic || item.courseName || "独立教学反思"}</strong><span>{item.date} · 来自真实反思 #{item.id}</span></li>)}</ul> : <p className={styles.noEvidence}>还没有已明确选择并沉淀的有效策略。</p>}</article>
          </div>
        </section>

        {open && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
          <div className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="reflection-dialog-title" aria-describedby="reflection-dialog-description" tabIndex={-1}>
            <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>{editing ? "创建 / 编辑 · 私密记录" : "创建 / 编辑 · 新建私密记录"}</p><h2 id="reflection-dialog-title">{editing ? "编辑教学反思" : "记录一节课后的反思"}</h2><p id="reflection-dialog-description">完整内容默认私密；教师文字先保存为私密记录，AI 只能提供待核对草稿。</p></div><button type="button" className={styles.iconButton} aria-label="关闭编辑窗口" disabled={mutationBusy || aiBusy} onClick={closeEditor}>×</button></div>
            <section className={styles.aiPanel} aria-labelledby="ai-panel-title"><div><p className={styles.eyebrow}>AI 反思草稿</p><h3 id="ai-panel-title">从真实课时记录生成待核对草稿</h3><p>调用 AI 前仍沿用现有隐私确认、字段排除和费用边界；AI 草稿不会自动保存、发布或覆盖教师文字。</p></div><button className={styles.aiButton} type="button" disabled={aiBusy || mutationBusy || !form.lessonId} onClick={() => void generateAiReflection()}>{aiBusy ? "正在生成草稿…" : "生成 AI 反思草稿"}</button></section>
            {aiError && <div className={styles.errorState} role="alert"><p>{aiError}</p><button type="button" className={styles.secondaryButton} onClick={() => void generateAiReflection()} disabled={aiBusy || mutationBusy || !form.lessonId}>重试 AI 草稿</button></div>}
            {aiMeta && <div className={styles.aiMeta} role="status"><strong>服务器已返回本次调用的边界信息</strong><details><summary>查看发送字段与排除字段</summary><p>发送：{aiMeta.sentFields.length ? aiMeta.sentFields.join("、") : "未返回字段清单"}</p><p>排除：{aiMeta.excludedFields.length ? aiMeta.excludedFields.join("、") : "未返回字段清单"}</p></details>{aiDraft?.uncertainty.length ? <ul>{aiDraft.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div>}
            {aiDraft && <section className={styles.draftPanel} aria-label="AI 反思草稿"><div className={styles.sectionHeader}><div><p className={styles.eyebrow}>AI 反思草稿</p><h3>草稿尚未保存（完整内容尚未私密保存）</h3></div><button type="button" className={styles.quietButton} onClick={discardAiDraft} disabled={mutationBusy || aiBusy}>丢弃草稿</button></div><p className={styles.draftNotice}>先逐项核对证据，再由教师决定是否“采用草稿”。采用只会补入空白字段，已有教师文字保持不变。</p><div className={styles.draftGrid}>{draftPreviewFields.map(([key, label]) => <div key={key}><span>{label}</span><p><b>教师内容</b>{nonEmpty(form[key]) || "尚未填写"}</p><strong><b>AI 草稿</b>{nonEmpty(aiDraft[key]) || "AI 未提供"}</strong></div>)}</div><button type="button" className={styles.secondaryButton} onClick={applyAiDraft} disabled={mutationBusy || aiBusy}>采用草稿（仅补入空白字段）</button>{aiDraft.evidenceSummary.length > 0 && <details className={styles.evidenceDetails}><summary>查看 AI 依据摘要（仍需教师核对）</summary><ul>{aiDraft.evidenceSummary.map((item) => <li key={item}>{item}</li>)}</ul></details>}</section>}
            <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
              {editorError && <div className={styles.errorState} role="alert"><p>{editorError}</p></div>}
              <div className={styles.formSection}><div className={styles.formSectionTitle}><p className={styles.eyebrow}>反思记录</p><h3>先记录事实，再写判断</h3></div><div className={styles.formGrid}>
                <label>日期<input type="date" value={form.date} onChange={(event) => setField("date", event.target.value)} required /></label>
                <label>关联课时<select value={form.lessonId} onChange={(event) => changeReflectionLesson(event.target.value)}><option value="">独立反思</option>{lessons.map((item) => <option value={item.id} key={item.id}>{item.date} · {item.topic || item.courseName || "未命名课时"}</option>)}</select></label>
                <label>问题类型<select value={form.problemType} onChange={(event) => setField("problemType", event.target.value)}><option value="">暂不归类</option>{problemTypes.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
                <label>主题标签<input value={form.tags} onChange={(event) => setField("tags", event.target.value)} placeholder="如：材料分析、规范表达" /></label>
                <label className={styles.wide}>预设与实际差异<textarea value={form.expectedVsActual} onChange={(event) => setField("expectedVsActual", event.target.value)} placeholder="写下预设、实际发生了什么，以及两者差异" /></label>
                <label>有效做法<textarea value={form.effectivePractices} onChange={(event) => setField("effectivePractices", event.target.value)} placeholder="哪一个做法被课堂证据支持？" /></label>
                <label>困难与原因<textarea value={form.difficulties} onChange={(event) => setField("difficulties", event.target.value)} placeholder="遇到的困难和可观察原因" /></label>
                <label>学生反馈证据<textarea value={form.studentEvidence} onChange={(event) => setField("studentEvidence", event.target.value)} placeholder="记录可核对的反馈、作业或课堂表现" /></label>
              </div></div>
              <div className={styles.formSection}><div className={styles.formSectionTitle}><p className={styles.eyebrow}>改进动作</p><h3>把下一步写成可以执行的动作</h3></div><div className={styles.formGrid}><label className={styles.wide}>下一次可执行改进动作<textarea value={form.nextAction} onChange={(event) => setField("nextAction", event.target.value)} placeholder="下节课何时、对谁、做什么？" /></label><label className={styles.wide}>可复用素材 / 话术 / 活动设计<textarea value={form.reusableMaterial} onChange={(event) => setField("reusableMaterial", event.target.value)} placeholder="只有教师确认后，才可单独沉淀为教学策略资源" /></label><label className={styles.checkboxLabel}><input type="checkbox" checked={form.actionCompleted} onChange={(event) => setField("actionCompleted", event.target.checked)} />改进动作已完成</label></div></div>
              <div className={styles.dialogActions}><button type="button" className={styles.quietButton} disabled={mutationBusy || aiBusy} onClick={closeEditor}>取消</button><button type="submit" className={styles.primaryButton} disabled={mutationBusy || aiBusy}>{mutationBusy ? "正在保存…" : "私密保存"}</button></div>
            </form>
          </div>
        </div>}
      </div>
    </AppShell>
  );
}
