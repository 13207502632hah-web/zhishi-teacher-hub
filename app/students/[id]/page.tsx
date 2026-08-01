"use client";

import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AppShell } from "../../components/AppShell";
import { HttpError, requestJson } from "../../lib/http-client";
import { personInitial } from "../../lib/display-format";
import styles from "./student-detail.module.css";

type Row = Record<string, unknown>;

type Student = {
  id: number;
  name: string;
  nickname?: string | null;
  grade?: string | null;
  school?: string | null;
  textbookVersion?: string | null;
  subjectChoice?: string | null;
  examGoal?: string | null;
  foundationLevel?: string | null;
  strengths?: string | null;
  weakKnowledge?: string | null;
  learningHabits?: string | null;
  stageGoal?: string | null;
  riskTags?: string | null;
  riskConfirmed?: boolean | string | null;
  status?: string | null;
  notes?: string | null;
  [key: string]: unknown;
};

type Attention = { level: string; title: string; evidence: string };
type TimelineItem = { date?: string; type?: string; title?: string; detail?: string; href?: string };

type StudentData = {
  student: Student;
  attention: Attention[];
  lessonRecords: Row[];
  submissions: Row[];
  feedback: Row[];
  results: Row[];
  wrongQuestions: Row[];
  knowledgeEvidence: Row[];
  questionResults: Row[];
};

type Mastery = {
  score?: number | null;
  effectiveScore?: number | null;
  explanation?: string | null;
  components?: Array<{ key?: string; label?: string; normalized?: number; effectiveWeight?: number; contribution?: number }>;
  manualAdjustment?: { overrideScore?: number; reason?: string; createdBy?: string; createdAt?: string } | null;
};

type Insights = {
  range: { start?: string; today?: string; midpoint?: string; weeks?: number };
  metrics: {
    attendance: { rate?: number | null; trend?: { label?: string; delta?: number | null } };
    homework: { rate?: number | null; trend?: { label?: string; delta?: number | null } };
    assessment: { rate?: number | null; trend?: { label?: string; delta?: number | null } };
    classroom: {
      understanding?: number | null;
      understandingTrend?: { label?: string; delta?: number | null };
      observationCount?: number;
    };
  };
  timeline: TimelineItem[];
};

type ScoreTrends = {
  trend?: string;
  stability?: number | null;
  series?: Array<{ name?: string; examDate?: string; score?: number; totalScore?: number; rate?: number; change?: number | null }>;
};

type Report = { month?: string; teacherDraft?: string; parentDraft?: string; confirmed?: boolean; note?: string };
type Recommendations = { questions?: Row[]; message?: string };
type AiRemediation = {
  summary: string;
  tiers: Array<{ level: string; target: string; actions: string[]; wrongQuestionIds: number[] }>;
  correctionSteps: string[];
  teacherChecks: string[];
  uncertainty: string[];
};

type StudentForm = {
  name: string;
  nickname: string;
  grade: string;
  school: string;
  textbookVersion: string;
  subjectChoice: string;
  examGoal: string;
  foundationLevel: string;
  strengths: string;
  weakKnowledge: string;
  learningHabits: string;
  riskTags: string;
  riskConfirmed: boolean;
  stageGoal: string;
  notes: string;
};

type WrongForm = { questionId: string; incorrectAnswer: string; reason: string };
type SectionKey = "archive" | "mastery" | "insights" | "trend";
type SectionState = { loading: boolean; error: string | null };
type Notice = { tone: "success" | "error"; text: string };
type DialogKind = "edit" | "wrong" | "mastery" | null;

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const sectionStateDefaults = (): Record<SectionKey, SectionState> => ({
  archive: { loading: true, error: null },
  mastery: { loading: true, error: null },
  insights: { loading: true, error: null },
  trend: { loading: true, error: null },
});

const text = (value: unknown, fallback = "") => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
};

const rows = (value: unknown) => (Array.isArray(value) ? (value as Row[]) : []);

const normalizeData = (payload: StudentData): StudentData => {
  if (!payload || !payload.student) throw new Error("服务器返回的学生档案不完整，请重试");
  return {
    student: payload.student,
    attention: Array.isArray(payload.attention) ? payload.attention : [],
    lessonRecords: rows(payload.lessonRecords),
    submissions: rows(payload.submissions),
    feedback: rows(payload.feedback),
    results: rows(payload.results),
    wrongQuestions: rows(payload.wrongQuestions),
    knowledgeEvidence: rows(payload.knowledgeEvidence),
    questionResults: rows(payload.questionResults),
  };
};

const formFromStudent = (student: Student): StudentForm => ({
  name: text(student.name),
  nickname: text(student.nickname),
  grade: text(student.grade, "高一"),
  school: text(student.school),
  textbookVersion: text(student.textbookVersion),
  subjectChoice: text(student.subjectChoice),
  examGoal: text(student.examGoal),
  foundationLevel: text(student.foundationLevel),
  strengths: text(student.strengths),
  weakKnowledge: text(student.weakKnowledge),
  learningHabits: text(student.learningHabits),
  riskTags: text(student.riskTags),
  riskConfirmed: Boolean(student.riskConfirmed),
  stageGoal: text(student.stageGoal),
  notes: text(student.notes),
});

const isAbortError = (reason: unknown, signal?: AbortSignal) =>
  Boolean(signal?.aborted) ||
  (typeof DOMException !== "undefined" && reason instanceof DOMException && reason.name === "AbortError");

const errorMessage = (reason: unknown, fallback: string) => {
  if (reason instanceof HttpError) {
    if (reason.status === 401) return "登录状态已失效，请重新登录";
    if (reason.status === 403) return "暂无权限执行此操作";
    return reason.message || fallback;
  }
  return reason instanceof Error && reason.message ? reason.message : fallback;
};

function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.sectionHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2 id={id}>{title}</h2>
        <p className={styles.sectionDescription}>{description}</p>
      </div>
      {action ? <div className={styles.sectionAction}>{action}</div> : null}
    </header>
  );
}

function LoadingBlock({ label = "正在读取" }: { label?: string }) {
  return (
    <div className={styles.loadingBlock} role="status" aria-live="polite">
      <span className={styles.loadingMark} aria-hidden="true" />
      <p>{label}，请稍候…</p>
    </div>
  );
}

function DataNote({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.dataNote}>
      <span className={styles.dataNoteMark} aria-hidden="true">
        —
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function SectionError({ message, onRetry, label = "重新读取" }: { message: string; onRetry: () => void; label?: string }) {
  return (
    <div className={styles.inlineError} role="alert">
      <div>
        <strong>这一部分暂时无法读取</strong>
        <p>{message}</p>
      </div>
      <button type="button" className={styles.buttonSecondary} onClick={onRetry}>
        {label}
      </button>
    </div>
  );
}

export default function StudentDetail() {
  const { id } = useParams<{ id: string }>();
  const encodedId = encodeURIComponent(id);
  const [data, setData] = useState<StudentData | null>(null);
  const [mastery, setMastery] = useState<Mastery | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [trends, setTrends] = useState<ScoreTrends | null>(null);
  const [sectionStates, setSectionStates] = useState<Record<SectionKey, SectionState>>(sectionStateDefaults);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [form, setForm] = useState<StudentForm>({ ...formFromStudent({ id: 0, name: "" }) });
  const [wrongForm, setWrongForm] = useState<WrongForm>({ questionId: "", incorrectAnswer: "", reason: "" });
  const [questionChoices, setQuestionChoices] = useState<Row[]>([]);
  const [masteryScore, setMasteryScore] = useState("");
  const [masteryReason, setMasteryReason] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [remediation, setRemediation] = useState<AiRemediation | null>(null);
  const [remediationMeta, setRemediationMeta] = useState<{ sentFields: string[]; excludedFields: string[] } | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [wrongSaveBusy, setWrongSaveBusy] = useState(false);
  const [masterySaveBusy, setMasterySaveBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [wrongStatusBusy, setWrongStatusBusy] = useState<number | null>(null);
  const [wrongDeleteBusy, setWrongDeleteBusy] = useState<number | null>(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [wrongQuestionLoadBusy, setWrongQuestionLoadBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [recommendationsBusy, setRecommendationsBusy] = useState(false);
  const [remediationBusy, setRemediationBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const editInitialRef = useRef<StudentForm>(form);
  const wrongInitialRef = useRef<WrongForm>(wrongForm);
  const masteryInitialRef = useRef({ score: "", reason: "" });
  const sectionControllersRef = useRef<Partial<Record<SectionKey, AbortController>>>({});

  const notify = useCallback((textValue: string, tone: Notice["tone"] = "success") => {
    setNotice({ text: textValue, tone });
  }, []);

  const setSectionLoading = useCallback((key: SectionKey) => {
    setSectionStates((previous) => ({ ...previous, [key]: { loading: true, error: null } }));
  }, []);

  const loadArchive = useCallback(
    async (signal: AbortSignal) => {
      setSectionLoading("archive");
      try {
        const payload = await requestJson<StudentData>(`/api/students/${encodedId}`, { signal });
        if (!payload) throw new Error("服务器返回空响应，无法读取学生档案");
        setData(normalizeData(payload));
      } catch (reason) {
        if (isAbortError(reason, signal)) return;
        setSectionStates((previous) => ({ ...previous, archive: { loading: false, error: errorMessage(reason, "无法读取学生档案") } }));
        return;
      }
      setSectionStates((previous) => ({ ...previous, archive: { loading: false, error: null } }));
    },
    [encodedId, setSectionLoading],
  );

  const loadMastery = useCallback(
    async (signal: AbortSignal) => {
      setSectionLoading("mastery");
      try {
        const payload = await requestJson<{ mastery?: Mastery | null }>(`/api/students/${encodedId}/mastery`, { signal });
        if (!payload) throw new Error("服务器返回空响应，无法读取掌握度");
        setMastery(payload.mastery ?? null);
      } catch (reason) {
        if (isAbortError(reason, signal)) return;
        setSectionStates((previous) => ({ ...previous, mastery: { loading: false, error: errorMessage(reason, "无法读取掌握度") } }));
        return;
      }
      setSectionStates((previous) => ({ ...previous, mastery: { loading: false, error: null } }));
    },
    [encodedId, setSectionLoading],
  );

  const loadInsights = useCallback(
    async (signal: AbortSignal) => {
      setSectionLoading("insights");
      try {
        const payload = await requestJson<Insights>(`/api/students/${encodedId}/insights?weeks=4`, { signal });
        if (!payload) throw new Error("服务器返回空响应，无法读取近四周变化");
        setInsights(payload);
      } catch (reason) {
        if (isAbortError(reason, signal)) return;
        setSectionStates((previous) => ({ ...previous, insights: { loading: false, error: errorMessage(reason, "无法读取近四周变化") } }));
        return;
      }
      setSectionStates((previous) => ({ ...previous, insights: { loading: false, error: null } }));
    },
    [encodedId, setSectionLoading],
  );

  const loadTrends = useCallback(
    async (signal: AbortSignal) => {
      setSectionLoading("trend");
      try {
        const payload = await requestJson<ScoreTrends>(`/api/students/${encodedId}/score-trends`, { signal });
        if (!payload) throw new Error("服务器返回空响应，无法读取成绩趋势");
        setTrends(payload);
      } catch (reason) {
        if (isAbortError(reason, signal)) return;
        setSectionStates((previous) => ({ ...previous, trend: { loading: false, error: errorMessage(reason, "无法读取成绩趋势") } }));
        return;
      }
      setSectionStates((previous) => ({ ...previous, trend: { loading: false, error: null } }));
    },
    [encodedId, setSectionLoading],
  );

  useEffect(() => {
    const controller = new AbortController();
    sectionControllersRef.current = {
      archive: controller,
      mastery: controller,
      insights: controller,
      trend: controller,
    };
    void loadArchive(controller.signal);
    void loadMastery(controller.signal);
    void loadInsights(controller.signal);
    void loadTrends(controller.signal);
    return () => {
      controller.abort();
      Object.values(sectionControllersRef.current).forEach((item) => item?.abort());
    };
  }, [loadArchive, loadInsights, loadMastery, loadTrends]);

  const retrySection = useCallback(
    (key: SectionKey) => {
      sectionControllersRef.current[key]?.abort();
      const controller = new AbortController();
      sectionControllersRef.current[key] = controller;
      const loaders: Record<SectionKey, (signal: AbortSignal) => Promise<void>> = {
        archive: loadArchive,
        mastery: loadMastery,
        insights: loadInsights,
        trend: loadTrends,
      };
      void loaders[key](controller.signal);
    },
    [loadArchive, loadInsights, loadMastery, loadTrends],
  );

  const openEdit = useCallback(() => {
    if (!data) return;
    const next = formFromStudent(data.student);
    setForm(next);
    editInitialRef.current = next;
    setDialog("edit");
  }, [data]);

  const openMastery = useCallback(() => {
    const nextScore = mastery?.effectiveScore ?? mastery?.score;
    const next = { score: nextScore == null ? "" : String(nextScore), reason: "" };
    setMasteryScore(next.score);
    setMasteryReason(next.reason);
    masteryInitialRef.current = next;
    setDialog("mastery");
  }, [mastery]);

  const openWrongQuestion = useCallback(async () => {
    if (wrongQuestionLoadBusy) return;
    setWrongQuestionLoadBusy(true);
    try {
      const payload = await requestJson<{ questions?: Row[] }>("/api/questions?status=active");
      if (!payload) throw new Error("服务器返回空响应，无法读取正式题库");
      const next = { questionId: "", incorrectAnswer: "", reason: "" };
      setQuestionChoices(rows(payload.questions));
      setWrongForm(next);
      wrongInitialRef.current = next;
      setDialog("wrong");
    } catch (reason) {
      notify(errorMessage(reason, "无法读取正式题库，登记错题失败"), "error");
    } finally {
      setWrongQuestionLoadBusy(false);
    }
  }, [notify, wrongQuestionLoadBusy]);

  const formDirty = dialog === "edit" && JSON.stringify(form) !== JSON.stringify(editInitialRef.current);
  const wrongDirty = dialog === "wrong" && JSON.stringify(wrongForm) !== JSON.stringify(wrongInitialRef.current);
  const masteryDirty = dialog === "mastery" &&
    (masteryScore !== masteryInitialRef.current.score || masteryReason !== masteryInitialRef.current.reason);
  const hasUnsavedChanges = formDirty || wrongDirty || masteryDirty;

  const closeDialog = useCallback(
    (force = false) => {
      if (!force && hasUnsavedChanges && !window.confirm("学生档案尚有未保存内容，确认放弃本次编辑吗？")) return;
      setDialog(null);
    },
    [hasUnsavedChanges],
  );

  useEffect(() => {
    if (!dialog) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousFocusRef.current = previous;
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialogRef.current)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [dialog]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "学生档案尚未保存";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeDialog],
  );

  const updateForm = useCallback(<K extends keyof StudentForm>(key: K, value: StudentForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  const save = useCallback(async () => {
    if (saveBusy) return;
    if (!form.name.trim() || !form.grade.trim()) {
      notify("保存失败：姓名与年级为必填项", "error");
      return;
    }
    setSaveBusy(true);
    try {
      const payload = await requestJson<{ student?: Student }>(`/api/students/${encodedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!payload) throw new Error("服务器返回空响应，无法确认保存结果");
      setData((previous) => (previous ? { ...previous, student: payload.student ?? { ...previous.student, ...form } } : previous));
      editInitialRef.current = form;
      closeDialog(true);
      notify("学生档案已更新");
    } catch (reason) {
      notify(errorMessage(reason, "保存失败，请稍后重试"), "error");
    } finally {
      setSaveBusy(false);
    }
  }, [closeDialog, encodedId, form, notify, saveBusy]);

  const archive = useCallback(async () => {
    if (archiveBusy || !data) return;
    if (!window.confirm("确认归档该学生？归档会停止其活跃状态，但不会删除课程、作业、反馈和测验历史。")) return;
    setArchiveBusy(true);
    try {
      const payload = await requestJson<{ ok?: boolean }>(`/api/students/${encodedId}`, { method: "DELETE" });
      if (!payload) throw new Error("服务器返回空响应，无法确认归档结果");
      setData((previous) => (previous ? { ...previous, student: { ...previous.student, status: "archived" } } : previous));
      notify("学生已归档；历史教学记录仍会保留");
    } catch (reason) {
      notify(errorMessage(reason, "操作失败：归档学生失败，请稍后重试"), "error");
    } finally {
      setArchiveBusy(false);
    }
  }, [archiveBusy, data, encodedId, notify]);

  const saveWrongQuestion = useCallback(async () => {
    if (wrongSaveBusy) return;
    if (!wrongForm.questionId) {
      notify("保存失败：请先选择一道正式题目", "error");
      return;
    }
    setWrongSaveBusy(true);
    try {
      const payload = await requestJson<{ updated?: boolean }>(`/api/students/${encodedId}/wrong-questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wrongForm),
      });
      if (!payload) throw new Error("服务器返回空响应，无法确认错题登记结果");
      closeDialog(true);
      notify(payload.updated ? "错题记录已更新并重新纳入巩固" : "错题已登记到学生档案");
      const controller = new AbortController();
      sectionControllersRef.current.archive?.abort();
      sectionControllersRef.current.archive = controller;
      void loadArchive(controller.signal);
    } catch (reason) {
      notify(errorMessage(reason, "保存失败：错题登记失败，请稍后重试"), "error");
    } finally {
      setWrongSaveBusy(false);
    }
  }, [closeDialog, encodedId, loadArchive, notify, wrongForm, wrongSaveBusy]);

  const saveMastery = useCallback(async () => {
    if (masterySaveBusy) return;
    const score = Number(masteryScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      notify("保存失败：掌握度必须是 0 至 100 的整数", "error");
      return;
    }
    if (masteryReason.trim().length < 4) {
      notify("保存失败：请填写至少 4 个字的修正依据", "error");
      return;
    }
    setMasterySaveBusy(true);
    try {
      const payload = await requestJson<{ mastery?: Mastery }>(`/api/students/${encodedId}/mastery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, reason: masteryReason.trim() }),
      });
      if (!payload) throw new Error("服务器返回空响应，无法确认掌握度修正结果");
      setMastery(payload.mastery ?? null);
      closeDialog(true);
      notify("掌握度人工修正已保存，并记录了修正依据");
    } catch (reason) {
      notify(errorMessage(reason, "保存失败：掌握度人工修正失败，请稍后重试"), "error");
    } finally {
      setMasterySaveBusy(false);
    }
  }, [closeDialog, encodedId, masteryReason, masterySaveBusy, masteryScore, notify]);

  const setWrongStatus = useCallback(
    async (wrongQuestionId: number, status: "active" | "mastered") => {
      if (wrongStatusBusy !== null || wrongDeleteBusy !== null) return;
      setWrongStatusBusy(wrongQuestionId);
      try {
        const payload = await requestJson<{ ok?: boolean }>(`/api/students/${encodedId}/wrong-questions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wrongQuestionId, status }),
        });
        if (!payload) throw new Error("服务器返回空响应，无法确认错题状态");
        setData((previous) =>
          previous
            ? {
                ...previous,
                wrongQuestions: previous.wrongQuestions.map((item) =>
                  Number(item.id) === wrongQuestionId ? { ...item, status } : item,
                ),
              }
            : previous,
        );
        notify(status === "mastered" ? "已标记为掌握" : "已重新纳入错题巩固");
      } catch (reason) {
        notify(errorMessage(reason, "操作失败：更新错题状态失败，请稍后重试"), "error");
      } finally {
        setWrongStatusBusy(null);
      }
    },
    [encodedId, notify, wrongDeleteBusy, wrongStatusBusy],
  );

  const removeWrongQuestion = useCallback(
    async (wrongQuestionId: number) => {
      if (wrongDeleteBusy !== null || wrongStatusBusy !== null) return;
      if (!window.confirm("确认删除这条错题记录？删除后无法恢复，相关错题闭环证据也会从档案中移除。")) return;
      setWrongDeleteBusy(wrongQuestionId);
      try {
        const payload = await requestJson<{ ok?: boolean }>(`/api/students/${encodedId}/wrong-questions`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wrongQuestionId }),
        });
        if (!payload) throw new Error("服务器返回空响应，无法确认删除结果");
        setData((previous) =>
          previous ? { ...previous, wrongQuestions: previous.wrongQuestions.filter((item) => Number(item.id) !== wrongQuestionId) } : previous,
        );
        notify("错题记录已删除");
      } catch (reason) {
        notify(errorMessage(reason, "操作失败：删除错题记录失败，请稍后重试"), "error");
      } finally {
        setWrongDeleteBusy(null);
      }
    },
    [encodedId, notify, wrongDeleteBusy, wrongStatusBusy],
  );

  const reveal = useCallback(async () => {
    if (privateBusy) return;
    if (!window.confirm("监护人联系方式属于敏感信息。确认因教学沟通需要查看？本次查看会生成审计记录。")) return;
    setPrivateBusy(true);
    try {
      const payload = await requestJson<{ guardianContact?: string }>(`/api/students/${encodedId}/private`, { timeoutMs: 10_000 });
      if (!payload) throw new Error("服务器返回空响应，无法确认联系方式");
      setContact(text(payload.guardianContact, "未填写"));
      notify("已按教师确认显示联系方式，本次查看已记录审计");
    } catch (reason) {
      notify(errorMessage(reason, "权限不足：当前角色无法查看监护人联系方式"), "error");
    } finally {
      setPrivateBusy(false);
    }
  }, [encodedId, notify, privateBusy]);

  const createReport = useCallback(async () => {
    if (reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      const payload = await requestJson<Report>(`/api/students/${encodedId}/monthly-report`);
      if (!payload) throw new Error("服务器返回空响应，无法生成月报");
      setReport(payload);
      notify("月度学情报告草稿已生成，教师确认后使用");
    } catch (reason) {
      const message = errorMessage(reason, "操作失败：生成月报失败，请稍后重试");
      setReportError(message);
      notify(message, "error");
    } finally {
      setReportBusy(false);
    }
  }, [encodedId, notify, reportBusy]);

  const loadRecommendations = useCallback(async () => {
    if (recommendationsBusy) return;
    setRecommendationsBusy(true);
    setRecommendationsError(null);
    try {
      const payload = await requestJson<Recommendations>(`/api/students/${encodedId}/recommendations`);
      if (!payload) throw new Error("服务器返回空响应，无法生成推荐");
      setRecommendations(payload);
      notify("推荐已生成，仅供教师确认，不会自动布置");
    } catch (reason) {
      const message = errorMessage(reason, "操作失败：读取推荐失败，请稍后重试");
      setRecommendationsError(message);
      notify(message, "error");
    } finally {
      setRecommendationsBusy(false);
    }
  }, [encodedId, notify, recommendationsBusy]);

  const generateRemediation = useCallback(async () => {
    if (remediationBusy) return;
    setRemediationBusy(true);
    try {
      const payload = await requestJson<{
        draft?: AiRemediation;
        sentFields?: string[];
        excludedFields?: string[];
      }>("/api/ai/wrong-question-remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: Number(id) }),
      });
      if (!payload?.draft) throw new Error("服务器返回空响应，无法生成 AI 订正草稿");
      setRemediation(payload.draft);
      setRemediationMeta({ sentFields: payload.sentFields ?? [], excludedFields: payload.excludedFields ?? [] });
      notify("AI 分层订正建议已生成，尚未布置或写入学生档案");
    } catch (reason) {
      notify(errorMessage(reason, "操作失败：AI 订正建议生成失败，请稍后重试"), "error");
    } finally {
      setRemediationBusy(false);
    }
  }, [id, notify, remediationBusy]);

  const copyText = useCallback(
    async (value: string, successMessage: string) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(value);
        notify(successMessage);
      } catch {
        notify("剪贴板不可用，复制失败；请手动选择文本。", "error");
      }
    },
    [notify],
  );

  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!data) return [];
    const fallbackItems: TimelineItem[] = [
      ...data.lessonRecords.map((item) => ({
        date: text(item.date, "日期待补"),
        type: "课时表现",
        title: text(item.topic ?? item.courseName, "课程记录"),
        detail: `参与 ${text(item.participation, "—")}/5 · 理解 ${text(item.understanding, "—")}/5 · 完成 ${text(item.completion, "—")}/5${text(item.teacherNote) ? ` · ${text(item.teacherNote)}` : ""}`,
        href: `/lessons/${text(item.lesson_id)}`,
      })),
      ...data.submissions.map((item) => ({
        date: text(item.lessonDate ?? item.dueAt ?? item.createdAt, "日期待补").slice(0, 10),
        type: text(item.status) === "corrected" ? "订正" : "作业",
        title: text(item.title, "作业记录"),
        detail: text(item.status, "状态待补"),
        href: `/assignments?q=${encodeURIComponent(text(item.title))}`,
      })),
      ...data.feedback.map((item) => ({
        date: text(item.lessonDate ?? item.created_at, "日期待补").slice(0, 10),
        type: "反馈",
        title: text(item.topic, "课程反馈"),
        detail: text(item.status) === "confirmed" ? "已确认" : "草稿",
        href: `/feedback?studentId=${encodedId}&status=${encodeURIComponent(text(item.status))}`,
      })),
      ...data.results.map((item) => ({
        date: text(item.date, "日期待补").slice(0, 10),
        type: "测验",
        title: text(item.title, "测验结果"),
        detail: item.score == null ? "待录入成绩" : `${text(item.score)} / ${text(item.totalScore, "—")} 分`,
        href: "/assessments",
      })),
      ...data.wrongQuestions.map((item) => ({
        date: text(item.occurredAt, "日期待补").slice(0, 10),
        type: "错题",
        title: text(item.stem, "政治错题"),
        detail: text(item.status) === "mastered" ? "已掌握" : `待巩固${text(item.knowledgePoints) ? ` · ${text(item.knowledgePoints)}` : ""}`,
        href: "#wrong-questions",
      })),
    ];
    return insights?.timeline?.length
      ? insights.timeline
      : fallbackItems.sort((left, right) => String(right.date).localeCompare(String(left.date)));
  }, [data, encodedId, insights]);

  const activeWrongQuestions = useMemo(
    () => (data?.wrongQuestions ?? []).filter((item) => text(item.status) === "active"),
    [data?.wrongQuestions],
  );

  const headerActions = (
    <>
      <button type="button" className={styles.headerButton} onClick={() => void createReport()} disabled={reportBusy}>
        {reportBusy ? "正在生成月报…" : "生成本月报告"}
      </button>
      <a className={styles.headerButton} href={`/feedback?new=1&type=stage&student=${encodedId}`}>
        生成阶段总结
      </a>
      <button type="button" className={styles.headerButton} onClick={() => void openWrongQuestion()} disabled={wrongQuestionLoadBusy}>
        {wrongQuestionLoadBusy ? "正在读取题库…" : "登记错题"}
      </button>
      <button type="button" className={styles.headerButton} onClick={openEdit} disabled={!data}>
        编辑档案
      </button>
      <button type="button" className={styles.headerDangerButton} onClick={() => void archive()} disabled={archiveBusy || !data}>
        {archiveBusy ? "正在归档…" : "归档学生"}
      </button>
    </>
  );

  if (!data && sectionStates.archive.loading) {
    return (
      <AppShell title="学生档案">
        <div className={styles.page}>
          <LoadingBlock label="正在读取学生完整成长档案" />
        </div>
      </AppShell>
    );
  }

  if (!data && sectionStates.archive.error) {
    return (
      <AppShell title="学生档案">
        <div className={styles.page}>
          <SectionError message={sectionStates.archive.error} onRetry={() => retrySection("archive")} label="重新读取档案" />
        </div>
      </AppShell>
    );
  }

  if (!data) return null;

  const student = data.student;
  const studentName = text(student.name, "未命名学生");
  const statusLabel = text(student.status) === "archived" ? "已归档" : "活跃中";
  const riskConfirmed = Boolean(student.riskConfirmed);
  const trendSeries = trends?.series ?? [];

  const dialogTitle = dialog === "edit" ? "编辑学生信息" : dialog === "wrong" ? "登记学生错题" : "人工修正掌握度";
  const dialogTitleId = `${dialog}-dialog-title`;
  const dialogDescriptionId = `${dialog}-dialog-description`;

  return (
    <AppShell title={studentName} subtitle={`${text(student.grade, "年级待补")} · 学习成长档案`} actions={headerActions}>
      <div className={styles.page}>
        {notice ? (
          <div className={`${styles.notice} ${notice.tone === "error" ? styles.noticeError : styles.noticeSuccess}`} role={notice.tone === "error" ? "alert" : "status"}>
            <p>{notice.text}</p>
            <button type="button" className={styles.iconButton} aria-label="关闭提示" onClick={() => setNotice(null)}>
              ×
            </button>
          </div>
        ) : null}

        {sectionStates.archive.error ? (
          <SectionError message={sectionStates.archive.error} onRetry={() => retrySection("archive")} label="重新读取档案" />
        ) : null}

        <section className={styles.heroCard} aria-labelledby="student-profile-title">
          <div className={styles.heroIdentity}>
            <span className={styles.avatar} aria-hidden="true">
              {personInitial(studentName)}
            </span>
            <div>
              <p className={styles.eyebrow}>学生完整成长档案</p>
              <h2 id="student-profile-title">{studentName}</h2>
              <p className={styles.heroSubtitle}>
                {text(student.nickname, "未设置昵称")} · {text(student.school, "学校待补")} · {text(student.textbookVersion, "教材待补")}
              </p>
            </div>
            <span className={`${styles.statusBadge} ${statusLabel === "已归档" ? styles.statusMuted : styles.statusActive}`}>{statusLabel}</span>
          </div>
          <div className={styles.heroFacts}>
            <div>
              <span>选科 / 考试目标</span>
              <strong>{text(student.subjectChoice, "待记录")} · {text(student.examGoal, "待记录")}</strong>
            </div>
            <div>
              <span>基础水平</span>
              <strong>{text(student.foundationLevel, "待记录")}</strong>
            </div>
            <div>
              <span>阶段目标</span>
              <strong>{text(student.stageGoal, "待制定")}</strong>
            </div>
            <div>
              <span>学习关注</span>
              <strong>{riskConfirmed ? `教师确认关注 · ${text(student.riskTags, "待补充")}` : "尚未确认风险"}</strong>
            </div>
          </div>
          <div className={styles.sensitiveNote}>
            <div>
              <strong>监护人联系方式属于敏感信息</strong>
              <p>{contact ? `已按教师确认显示：${contact}（本次查看已记录审计）` : "普通档案视图不提前暴露联系方式；因教学沟通需要时再确认查看。"}</p>
            </div>
            <button type="button" className={styles.buttonSecondary} onClick={() => void reveal()} disabled={privateBusy}>
              {privateBusy ? "正在核验权限…" : contact ? "再次查看审计说明" : "教师确认后查看"}
            </button>
          </div>
        </section>

        <section className={`${styles.section} ${styles.attentionSection}`} aria-labelledby="attention-title">
          <SectionHeader id="attention-title" eyebrow="当前优先级" title="学习关注事项" description="每一项都显示事实依据；没有足够记录时不会生成风险结论。" />
          {data.attention.length ? (
            <div className={styles.attentionGrid}>
              {data.attention.map((item, index) => (
                <article className={`${styles.attentionCard} ${item.level === "high" ? styles.attentionHigh : ""}`} key={`${item.title}-${index}`}>
                  <span>{item.level === "high" ? "需要优先处理" : "持续观察"}</span>
                  <h3>{item.title}</h3>
                  <p>{item.evidence}</p>
                </article>
              ))}
            </div>
          ) : (
            <DataNote title="当前没有需要特别处理的事项" description="系统不会在缺少真实记录时生成风险结论。" />
          )}
        </section>

        <section className={styles.section} aria-labelledby="insights-title">
          <SectionHeader id="insights-title" eyebrow="最近四周" title="近四周学习变化" description="按出勤、作业、测验和课堂记录统计；趋势只在前后阶段都有事实记录时显示。" />
          {sectionStates.insights.loading ? <LoadingBlock label="正在读取近四周变化" /> : sectionStates.insights.error ? <SectionError message={sectionStates.insights.error} onRetry={() => retrySection("insights")} /> : insights ? (
            <>
              <div className={styles.rangeNote}>
                统计区间：{text(insights.range.start, "起始日期待补")} 至 {text(insights.range.today, "今日待补")} · 对比最近 14 天与此前 14 天
              </div>
              <div className={styles.metricGrid}>
                <article className={styles.metricCard}><span>出勤率</span><strong>{insights.metrics.attendance.rate == null ? "数据不足" : `${Math.round(insights.metrics.attendance.rate)}%`}</strong><small>{text(insights.metrics.attendance.trend?.label, "数据不足")}</small></article>
                <article className={styles.metricCard}><span>作业完成率</span><strong>{insights.metrics.homework.rate == null ? "数据不足" : `${Math.round(insights.metrics.homework.rate)}%`}</strong><small>{text(insights.metrics.homework.trend?.label, "数据不足")}</small></article>
                <article className={styles.metricCard}><span>测验得分率</span><strong>{insights.metrics.assessment.rate == null ? "数据不足" : `${Math.round(insights.metrics.assessment.rate)}%`}</strong><small>{text(insights.metrics.assessment.trend?.label, "数据不足")}</small></article>
                <article className={styles.metricCard}><span>课堂理解度</span><strong>{insights.metrics.classroom.understanding == null ? "数据不足" : `${Number(insights.metrics.classroom.understanding).toFixed(1)}/5`}</strong><small>{text(insights.metrics.classroom.understandingTrend?.label, "数据不足")}</small></article>
                <article className={styles.metricCard}><span>教师观察</span><strong>{insights.metrics.classroom.observationCount ?? "数据不足"}</strong><small>只统计已记录内容</small></article>
              </div>
              <details className={styles.evidenceDetails}>
                <summary>查看近四周计算依据</summary>
                <p>出勤率 = 出勤或迟到次数 ÷ 统计区间内出勤记录；作业完成率 = 已完成或已订正次数 ÷ 作业记录；测验得分率按实际总分计算。前后阶段缺少记录时显示“数据不足”。</p>
              </details>
            </>
          ) : <DataNote title="近四周没有可用记录" description="录入出勤、作业、测验或课堂表现后，系统会形成可解释变化。" />}
        </section>

        <section className={styles.section} aria-labelledby="mastery-title">
          <SectionHeader id="mastery-title" eyebrow="可解释计算" title="综合学习掌握度" description="保留系统原始计算、有效权重和教师人工修正依据。" action={<button type="button" className={styles.buttonSecondary} onClick={openMastery}>教师人工修正</button>} />
          {sectionStates.mastery.loading ? <LoadingBlock label="正在读取掌握度" /> : sectionStates.mastery.error ? <SectionError message={sectionStates.mastery.error} onRetry={() => retrySection("mastery")} /> : mastery?.score == null ? (
            <DataNote title="数据不足" description={mastery?.explanation || "录入测验、作业、课堂理解度或错题掌握状态后计算。"} />
          ) : (
            <>
              <div className={styles.scoreSummary}>
                <div><span>当前掌握度</span><strong>{mastery.effectiveScore ?? mastery.score}%</strong></div>
                <div><span>系统计算</span><strong>{mastery.score}%</strong></div>
                <div><span>最近修正</span><strong>{mastery.manualAdjustment ? `${mastery.manualAdjustment.overrideScore}%` : "无"}</strong></div>
              </div>
              <p className={styles.evidenceLead}>{text(mastery.explanation, "计算依据待补")}</p>
              <div className={styles.evidenceList}>
                {(mastery.components ?? []).map((item, index) => <p key={item.key ?? `${item.label}-${index}`}><span>{text(item.label, "指标")} · {item.normalized ?? "数据不足"} 分 · 有效权重 {item.effectiveWeight ?? "数据不足"}%</span><strong>贡献 {item.contribution == null ? "数据不足" : Math.round(item.contribution)} 分</strong></p>)}
              </div>
              {mastery.manualAdjustment ? <p className={styles.manualNote}><strong>最近修正依据：</strong>{text(mastery.manualAdjustment.reason, "未填写")} · {text(mastery.manualAdjustment.createdBy, "教师待补")}</p> : null}
            </>
          )}
        </section>

        <section className={styles.section} aria-labelledby="trend-title">
          <SectionHeader id="trend-title" eyebrow="阶段成绩" title="成绩趋势与稳定性" description="只展示已有考试结果的变化，不用单次成绩虚构长期结论。" />
          {sectionStates.trend.loading ? <LoadingBlock label="正在读取成绩趋势" /> : sectionStates.trend.error ? <SectionError message={sectionStates.trend.error} onRetry={() => retrySection("trend")} /> : trends && trendSeries.length ? (
            <>
              <div className={styles.trendSummary}><div><span>阶段判断</span><strong>{text(trends.trend, "数据不足")}</strong></div><div><span>分数稳定性</span><strong>{trends.stability == null ? "数据不足" : trends.stability.toFixed(1)}</strong></div><div><span>依据</span><strong>{trendSeries.length} 次已录成绩</strong></div></div>
              <div className={styles.tableWrap}>
                <table className={styles.trendTable}>
                  <caption>成绩趋势明细</caption>
                  <thead><tr><th>考试</th><th>日期</th><th>得分率</th><th>较上次</th></tr></thead>
                  <tbody>{trendSeries.map((item, index) => <tr key={`${item.name}-${item.examDate}-${index}`}><td>{text(item.name, "考试记录")}</td><td>{text(item.examDate, "日期待补")}</td><td>{item.rate == null ? "数据不足" : `${Math.round(item.rate)}%`}</td><td>{item.change == null ? "数据不足" : `${item.change > 0 ? "+" : ""}${item.change.toFixed(1)} 个百分点`}</td></tr>)}</tbody>
                </table>
              </div>
              <details className={styles.evidenceDetails}><summary>查看趋势计算依据</summary><p>得分率 = 实得分 ÷ 试卷总分；较上次为相邻考试得分率差值；稳定性使用已有阶段成绩的离散程度。记录少于两次时显示“数据不足”。</p></details>
            </>
          ) : <DataNote title="数据不足" description="至少录入两次有总分的考试结果后，才显示趋势判断。" />}
        </section>

        <div className={styles.twoColumn}>
          <section className={styles.section} aria-labelledby="profile-title">
            <SectionHeader id="profile-title" eyebrow="档案信息" title="学习基本信息" description="事实字段与教师确认项分开呈现。" />
            <dl className={styles.profileList}>
              <div><dt>学校 / 教材</dt><dd>{text(student.school, "待记录")} · {text(student.textbookVersion, "待记录")}</dd></div>
              <div><dt>选科 / 考试目标</dt><dd>{text(student.subjectChoice, "待记录")} · {text(student.examGoal, "待记录")}</dd></div>
              <div><dt>基础水平</dt><dd>{text(student.foundationLevel, "待记录")}</dd></div>
              <div><dt>优势</dt><dd>{text(student.strengths, "待记录")}</dd></div>
              <div><dt>薄弱知识点</dt><dd>{text(student.weakKnowledge, "待记录")}</dd></div>
              <div><dt>学习习惯</dt><dd>{text(student.learningHabits, "待记录")}</dd></div>
              <div><dt>阶段目标</dt><dd>{text(student.stageGoal, "待制定")}</dd></div>
              <div><dt>备注</dt><dd>{text(student.notes, "暂无备注")}</dd></div>
            </dl>
          </section>

          <section className={styles.section} aria-labelledby="timeline-title">
            <SectionHeader id="timeline-title" eyebrow="真实记录" title="成长时间线" description="优先显示可追溯的出勤、作业、反馈、测验、课堂观察和错题记录。" />
            {timelineItems.length === 0 ? <DataNote title="还没有成长记录" description="完成一次课时表现、出勤、作业、订正、测验、反馈或错题登记后，会按时间显示在这里。" /> : (
              <>
                <div className={styles.countGrid}><span>课时表现 <strong>{data.lessonRecords.length}</strong></span><span>作业记录 <strong>{data.submissions.length}</strong></span><span>课程反馈 <strong>{data.feedback.length}</strong></span><span>测验结果 <strong>{data.results.length}</strong></span><span>待巩固错题 <strong>{activeWrongQuestions.length}</strong></span></div>
                <div className={styles.timeline}>{timelineItems.map((item, index) => <a className={styles.timelineItem} href={item.href || "#"} key={`${item.type}-${item.date}-${index}`}><time>{text(item.date, "日期待补")}</time><span>{text(item.type, "记录")}</span><div><strong>{text(item.title, "未命名记录")}</strong><p>{text(item.detail, "详情待补")}</p></div></a>)}</div>
              </>
            )}
          </section>
        </div>

        <section className={styles.section} aria-labelledby="knowledge-title">
          <SectionHeader id="knowledge-title" eyebrow="教材证据" title="教材熟悉程度与知识点" description="按册次—单元—课—框—知识点保留来源与教师修正标记。" />
          {data.knowledgeEvidence.length ? <div className={styles.evidenceList}>{data.knowledgeEvidence.map((item, index) => <p key={`${text(item.knowledgeName)}-${index}`}><span>{text(item.path, text(item.knowledgeName, "知识点待补"))} · {text(item.level, "数据不足")}</span><strong>{text(item.evidence, "证据待补")}{item.isManual ? " · 教师修正" : ""}</strong></p>)}</div> : <DataNote title="暂无教材熟悉度证据" description="确认逐题成绩、错题或教师人工评价后显示四级掌握状态。" />}
        </section>

        <section className={styles.section} id="wrong-questions" aria-labelledby="wrong-title">
          <SectionHeader
            id="wrong-title"
            eyebrow="错题闭环"
            title="错题与掌握状态"
            description="登记、巩固、掌握和删除都有明确反馈；删除属于危险操作。"
              action={<div className={styles.actionRow}><button type="button" className={styles.buttonSecondary} onClick={() => void openWrongQuestion()} disabled={wrongQuestionLoadBusy}>{wrongQuestionLoadBusy ? "正在读取题库…" : "登记错题"}</button><button type="button" className={styles.buttonPrimary} disabled={remediationBusy || activeWrongQuestions.length === 0} onClick={() => void generateRemediation()}>{remediationBusy ? "正在生成草稿…" : remediation ? "重新生成 AI 分层订正草稿" : "生成 AI 分层订正草稿"}</button></div>}
          />
          <p className={styles.aiDisclaimer}>AI 只生成待教师审阅的草稿，引用教师已登记错题与正式题库已有答案；不会自动布置、发送或写入学生档案。</p>
          {remediation ? <div className={styles.aiDraft}><div className={styles.aiDraftHeader}><div><p className={styles.eyebrow}>待教师确认</p><h3>{remediation.summary}</h3></div><button type="button" className={styles.buttonSecondary} onClick={() => void copyText([remediation.summary, ...remediation.tiers.map((tier) => `${tier.level}｜${tier.target}\n${tier.actions.join("\n")}`), `订正步骤\n${remediation.correctionSteps.join("\n")}`].join("\n\n"), "订正草稿已复制")}>复制草稿</button></div><div className={styles.aiTierGrid}>{remediation.tiers.map((tier) => <article key={tier.level}><strong>{tier.level}</strong><span>{tier.target}</span><small>对应错题：{tier.wrongQuestionIds.map((wrongId) => `#${wrongId}`).join("、") || "数据不足"}</small><p>{tier.actions.join("\n")}</p></article>)}</div>{remediation.correctionSteps.length ? <div className={styles.confirmationNote}><strong>建议订正步骤</strong>{remediation.correctionSteps.map((item) => <span key={item}>{item}</span>)}</div> : null}{[...remediation.teacherChecks, ...remediation.uncertainty].length ? <div className={styles.confirmationNote}><strong>需要教师确认</strong>{[...remediation.teacherChecks, ...remediation.uncertainty].map((item) => <span key={item}>{item}</span>)}</div> : null}{remediationMeta ? <details className={styles.evidenceDetails}><summary>查看本次发送与排除字段</summary><p>发送：{remediationMeta.sentFields.join("、") || "无"}</p><p>排除：{remediationMeta.excludedFields.join("、") || "无"}</p></details> : null}</div> : null}
          {data.wrongQuestions.length === 0 ? <DataNote title="还没有错题记录" description="登记真实错题后，可追踪巩固和掌握状态。" /> : <div className={styles.wrongList}>{data.wrongQuestions.map((item) => { const wrongId = Number(item.id); const status = text(item.status); const busy = wrongStatusBusy === wrongId || wrongDeleteBusy === wrongId; return <article className={styles.wrongItem} key={wrongId}><div><span className={`${styles.statusBadge} ${status === "mastered" ? styles.statusActive : styles.statusWarning}`}>{status === "mastered" ? "已掌握" : "待巩固"}</span><h3>{text(item.stem, "政治错题")}</h3><p>{text(item.knowledgePoints, "知识点待标注")}{text(item.lessonTopic) ? ` · ${text(item.lessonTopic)}` : ""}</p>{text(item.incorrectAnswer) ? <p>学生作答：{text(item.incorrectAnswer)}</p> : null}{text(item.reason) ? <p>错因备注：{text(item.reason)}</p> : null}</div><div className={styles.actionRow}><button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void setWrongStatus(wrongId, status === "mastered" ? "active" : "mastered")}>{wrongStatusBusy === wrongId ? "正在保存…" : status === "mastered" ? "重新巩固" : "标记已掌握"}</button><button type="button" className={styles.buttonDangerText} disabled={busy} onClick={() => void removeWrongQuestion(wrongId)}>{wrongDeleteBusy === wrongId ? "正在删除…" : "删除错题"}</button></div></article>; })}</div>}
        </section>

        <div className={styles.twoColumn}>
          <section className={styles.section} aria-labelledby="report-title">
            <SectionHeader id="report-title" eyebrow="教师草稿" title="月度学情报告" description="月报仅供教师确认后使用，不会自动发送给家长。" action={<button type="button" className={styles.buttonSecondary} onClick={() => void createReport()} disabled={reportBusy}>{reportBusy ? "正在生成…" : "生成月报"}</button>} />
            {reportError ? <SectionError message={reportError} onRetry={() => void createReport()} label="重新生成月报" /> : report ? <div className={styles.reportDraft}><p className={styles.statusLine}>{text(report.month, "本月")} · {text(report.note, "教师确认后使用")}</p><h3>教师详细版</h3><p>{text(report.teacherDraft, "暂无草稿")}</p><h3>家长微信简版</h3><p>{text(report.parentDraft, "暂无草稿")}</p><div className={styles.actionRow}><button type="button" className={styles.buttonSecondary} onClick={() => void copyText(text(report.parentDraft), "家长版草稿已复制")}>复制家长版</button><button type="button" className={styles.buttonQuiet} onClick={() => setReport(null)}>关闭草稿</button></div></div> : <DataNote title="尚未生成月报" description="按需生成本月教师草稿，确认内容后再另行使用。" />}
          </section>

          <section className={styles.section} aria-labelledby="recommendation-title">
            <SectionHeader id="recommendation-title" eyebrow="教师确认" title="薄弱知识点巩固推荐" description="排除近 30 天已使用题；推荐不会自动布置，必须由教师确认。" action={<button type="button" className={styles.buttonSecondary} onClick={() => void loadRecommendations()} disabled={recommendationsBusy}>{recommendationsBusy ? "正在生成…" : "生成推荐"}</button>} />
            {recommendationsError ? <SectionError message={recommendationsError} onRetry={() => void loadRecommendations()} label="重新生成推荐" /> : recommendations?.questions?.length ? <div className={styles.recommendationList}>{recommendations.questions.map((question, index) => <article key={`${text(question.id)}-${index}`}><div><span className={styles.statusBadge}>{text(question.difficulty, "题目")} · {text(question.questionType, "正式题")}</span><h3>{text(question.stem, "题干待补")}</h3><p>{text(question.knowledgePoints, "知识点待补")}</p></div><a className={styles.buttonQuiet} href={`/questions?q=${encodeURIComponent(text(question.stem).slice(0, 20))}`}>教师确认</a></article>)}</div> : recommendations ? <DataNote title="暂无匹配题目" description={text(recommendations.message, "正式题库中暂时没有匹配题目，请先补充知识点题目。")}/> : <DataNote title="尚未生成推荐" description="系统只从正式题库选择基础、提高和综合题；题量不足时会明确提示。" />}
            <div className={styles.stageFeedback}><div><strong>阶段反馈</strong><p>基于本页事实记录生成教师阶段总结草稿。</p></div><a className={styles.buttonSecondary} href={`/feedback?new=1&type=stage&student=${encodedId}`}>生成阶段总结</a></div>
          </section>
        </div>
      </div>

      {dialog ? (
        <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <div ref={dialogRef} className={`${styles.dialog} ${dialog === "mastery" ? styles.dialogSmall : ""}`} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
            <div className={styles.dialogHeader}><div><p className={styles.eyebrow}>{dialog === "edit" ? "更新成长档案" : dialog === "wrong" ? "基于正式题库" : "保留系统计算与修正记录"}</p><h2 id={dialogTitleId}>{dialogTitle}</h2><p id={dialogDescriptionId} className={styles.dialogDescription}>{dialog === "edit" ? "修改后可随时取消；离开前会保护未保存内容。" : dialog === "wrong" ? "错题登记会进入成长时间线，并保留教师可追溯的错因记录。" : "系统原始分不会被覆盖；每次修正都需要记录教师依据。"}</p></div><button type="button" className={styles.iconButton} aria-label="关闭弹窗" onClick={() => closeDialog()}>×</button></div>
            {dialog === "edit" ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}><div className={styles.fieldGrid}>
              <label className={styles.field}>姓名<input value={form.name} onChange={(event) => updateForm("name", event.target.value)} /></label>
              <label className={styles.field}>昵称<input value={form.nickname} onChange={(event) => updateForm("nickname", event.target.value)} /></label>
              <label className={styles.field}>年级<select value={form.grade} onChange={(event) => updateForm("grade", event.target.value)}>{["七年级", "八年级", "九年级", "高一", "高二", "高三"].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
              <label className={styles.field}>学校<input value={form.school} onChange={(event) => updateForm("school", event.target.value)} /></label>
              <label className={styles.field}>教材版本<input value={form.textbookVersion} onChange={(event) => updateForm("textbookVersion", event.target.value)} /></label>
              <label className={styles.field}>选科 / 考试方向<input value={form.subjectChoice} onChange={(event) => updateForm("subjectChoice", event.target.value)} /></label>
              <label className={styles.field}>考试目标<input value={form.examGoal} onChange={(event) => updateForm("examGoal", event.target.value)} /></label>
              <label className={styles.field}>基础水平<input value={form.foundationLevel} onChange={(event) => updateForm("foundationLevel", event.target.value)} /></label>
              <label className={styles.field}>优势<input value={form.strengths} onChange={(event) => updateForm("strengths", event.target.value)} /></label>
              <label className={styles.field}>薄弱知识点<input value={form.weakKnowledge} onChange={(event) => updateForm("weakKnowledge", event.target.value)} /></label>
              <label className={styles.field}>学习习惯<input value={form.learningHabits} onChange={(event) => updateForm("learningHabits", event.target.value)} /></label>
              <label className={styles.field}>风险标签<input value={form.riskTags} onChange={(event) => updateForm("riskTags", event.target.value)} /></label>
              <label className={styles.checkboxField}><input type="checkbox" checked={form.riskConfirmed} onChange={(event) => updateForm("riskConfirmed", event.target.checked)} />教师确认关注</label>
              <label className={`${styles.field} ${styles.fieldWide}`}>阶段目标<textarea value={form.stageGoal} onChange={(event) => updateForm("stageGoal", event.target.value)} /></label>
              <label className={`${styles.field} ${styles.fieldWide}`}>备注<textarea value={form.notes} onChange={(event) => updateForm("notes", event.target.value)} /></label>
            </div><p className={styles.sensitiveNote}>普通编辑不会覆盖监护人联系方式；如需查看或处理敏感字段，请使用页面上的教师确认入口。</p><div className={styles.modalActions}><button type="button" className={styles.buttonQuiet} onClick={() => closeDialog()}>取消</button><button type="submit" className={styles.buttonPrimary} disabled={saveBusy}>{saveBusy ? "正在保存…" : "保存档案"}</button></div></form> : null}
            {dialog === "wrong" ? <form onSubmit={(event) => { event.preventDefault(); void saveWrongQuestion(); }}><div className={styles.fieldGrid}><label className={`${styles.field} ${styles.fieldWide}`}>选择题目<select value={wrongForm.questionId} onChange={(event) => setWrongForm((previous) => ({ ...previous, questionId: event.target.value }))}><option value="">请选择正式题库题目</option>{questionChoices.map((question) => <option key={text(question.id)} value={text(question.id)}>{text(question.questionType, "正式题")} · {text(question.stem).slice(0, 60)}</option>)}</select></label><label className={styles.field}>学生本次作答<input value={wrongForm.incorrectAnswer} onChange={(event) => setWrongForm((previous) => ({ ...previous, incorrectAnswer: event.target.value }))} placeholder="如：选 B 或简要写法" /></label><label className={styles.field}>错因 / 巩固建议<input value={wrongForm.reason} onChange={(event) => setWrongForm((previous) => ({ ...previous, reason: event.target.value }))} placeholder="如：混淆概念、审题遗漏" /></label></div><p className={styles.sensitiveNote}>登记后会进入学生成长时间线；教师确认掌握后保留历史记录，不会自动生成布置任务。</p><div className={styles.modalActions}><button type="button" className={styles.buttonQuiet} onClick={() => closeDialog()}>取消</button><button type="submit" className={styles.buttonPrimary} disabled={wrongSaveBusy}>{wrongSaveBusy ? "正在保存…" : "保存错题"}</button></div></form> : null}
            {dialog === "mastery" ? <form onSubmit={(event) => { event.preventDefault(); void saveMastery(); }}><div className={styles.fieldGrid}><label className={styles.field}>掌握度（0–100）<input type="number" min="0" max="100" step="1" value={masteryScore} onChange={(event) => setMasteryScore(event.target.value)} /></label><label className={`${styles.field} ${styles.fieldWide}`}>修正依据<textarea value={masteryReason} onChange={(event) => setMasteryReason(event.target.value)} placeholder="例如：最近口头检测表现明显提升，系统尚未录入该次成绩" /></label></div><p className={styles.sensitiveNote}>系统原始分不会被覆盖；每次修正都会记录教师、时间、原始分与理由。</p><div className={styles.modalActions}><button type="button" className={styles.buttonQuiet} onClick={() => closeDialog()}>取消</button><button type="submit" className={styles.buttonPrimary} disabled={masterySaveBusy}>{masterySaveBusy ? "正在保存…" : "保存修正"}</button></div></form> : null}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
