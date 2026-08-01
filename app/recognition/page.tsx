"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AppShell, EmptyState } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import { parseAnswerCardOcr } from "../lib/answer-card-ocr";
import { REVIEW_CONFIDENCE } from "../lib/recognition";
import { recognizeChineseImage } from "../lib/local-ocr";
import styles from "./recognition.module.css";

type Row = Record<string, unknown> & { id: number; name?: string; title?: string };
type ReviewStatus = "pending" | "confirmed";
type Item = {
  id?: number;
  questionNumber: string;
  studentAnswer: string;
  standardAnswer: string;
  teacherScore: string;
  maxScore: string;
  knowledgePoints: string;
  confidence: number;
  candidates: unknown;
  errorType: string;
  reviewStatus: ReviewStatus;
};
type OperationStatus = "idle" | "loading" | "success" | "error";
type OperationState = { status: OperationStatus; error?: string };
type OcrMeta = {
  assessmentTitle: string;
  date: string;
  totalScore: number | null;
  confidence: number;
  studentId: number | null;
  studentName: string;
  assessmentId: number | null;
  studentCandidates: string[];
  assessmentCandidates: string[];
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const steps = ["选择学生与测验", "上传原图", "本机OCR", "逐题校对", "教师最终确认"];
const emptyOperation = (): OperationState => ({ status: "idle" });

const blankItem = (number: number): Item => ({
  questionNumber: String(number),
  studentAnswer: "",
  standardAnswer: "",
  teacherScore: "",
  maxScore: "",
  knowledgePoints: "",
  confidence: 0,
  candidates: [],
  errorType: "",
  reviewStatus: "pending",
});

const textValue = (value: unknown) => String(value ?? "").trim();
const errorMessage = (reason: unknown, fallback: string) => reason instanceof HttpError ? reason.message : fallback;

const validateRecognitionFile = (file: File | null) => {
  if (!file || !file.size) return "文件不能为空";
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "仅支持 JPG、PNG 或 WebP 图片";
  if (file.size > MAX_FILE_SIZE) return "答题卡图片必须小于 25MB";
  return "";
};

const normalizeItem = (value: Record<string, unknown>): Item => ({
  id: value.id == null ? undefined : Number(value.id),
  questionNumber: textValue(value.questionNumber ?? value.question_number),
  studentAnswer: textValue(value.studentAnswer ?? value.student_answer),
  standardAnswer: textValue(value.standardAnswer ?? value.standard_answer),
  teacherScore: value.teacherScore == null && value.teacher_score == null ? "" : String(value.teacherScore ?? value.teacher_score),
  maxScore: value.maxScore == null && value.max_score == null ? "" : String(value.maxScore ?? value.max_score),
  knowledgePoints: textValue(value.knowledgePoints ?? value.knowledge_points),
  confidence: Number(value.confidence ?? 0),
  candidates: value.candidates ?? [],
  errorType: textValue(value.errorType ?? value.error_type),
  reviewStatus: value.reviewStatus === "confirmed" || value.review_status === "confirmed" ? "confirmed" : "pending",
});

const normalizeItems = (values: unknown): Item[] => {
  if (!Array.isArray(values)) return [blankItem(1)];
  const items = values
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
    .map((value) => normalizeItem(value));
  return items.length ? items : [blankItem(1)];
};

const candidateValues = (value: unknown) => {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(textValue).filter(Boolean) : [value.trim()];
  } catch {
    return value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  }
};

const hasConflict = (item: Item) => candidateValues(item.candidates).length > 1 || /冲突|conflict/i.test(item.errorType);

const isScoreInvalid = (item: Item) => {
  if (!item.teacherScore.trim() || !item.maxScore.trim()) return false;
  const score = Number(item.teacherScore);
  const maxScore = Number(item.maxScore);
  return !Number.isFinite(score) || !Number.isFinite(maxScore) || score < 0 || maxScore <= 0 || score > maxScore;
};

const itemIssues = (item: Item) => {
  const issues: string[] = [];
  if (!item.questionNumber) issues.push("缺少题号");
  if (!item.studentAnswer) issues.push("缺少学生答案");
  if (!item.teacherScore || !item.maxScore) issues.push("得分或满分未填写");
  if (!item.knowledgePoints) issues.push("缺少知识点");
  if (isScoreInvalid(item)) issues.push("分数无效或超过满分");
  if (Number(item.confidence || 0) < REVIEW_CONFIDENCE) issues.push("OCR置信度不足");
  if (hasConflict(item)) issues.push("识别字段冲突");
  return issues;
};

const hardItemIssues = (item: Item) => itemIssues(item).filter((issue) => issue !== "OCR置信度不足");
const itemIsReady = (item: Item) => item.reviewStatus === "confirmed" && hardItemIssues(item).length === 0;

const fieldIsUncertain = (item: Item, field: keyof Pick<Item, "questionNumber" | "studentAnswer" | "teacherScore" | "maxScore" | "knowledgePoints">) => {
  if (Number(item.confidence || 0) < REVIEW_CONFIDENCE || hasConflict(item)) return true;
  if (field === "teacherScore" || field === "maxScore") return !textValue(item[field]) || isScoreInvalid(item);
  return !textValue(item[field]);
};

const fieldState = (item: Item, field: keyof Pick<Item, "questionNumber" | "studentAnswer" | "teacherScore" | "maxScore" | "knowledgePoints">) => {
  if (fieldIsUncertain(item, field)) return "存疑";
  return item.reviewStatus === "confirmed" ? "已确认" : "待校对";
};

const rowLabel = (row: Row, key: "name" | "title") => textValue(row[key]) || "未命名记录";

export default function RecognitionPage() {
  const [students, setStudents] = useState<Row[]>([]);
  const [assessments, setAssessments] = useState<Row[]>([]);
  const [studentId, setStudentId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [studentSelectionReviewed, setStudentSelectionReviewed] = useState(false);
  const [assessmentSelectionReviewed, setAssessmentSelectionReviewed] = useState(false);
  const [studentLoading, setStudentLoading] = useState(false);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [studentLoadError, setStudentLoadError] = useState("");
  const [assessmentLoadError, setAssessmentLoadError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [assetId, setAssetId] = useState<number | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [ocrMeta, setOcrMeta] = useState<OcrMeta | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [uploadState, setUploadState] = useState<OperationState>(emptyOperation);
  const [ocrState, setOcrState] = useState<OperationState>(emptyOperation);
  const [saveState, setSaveState] = useState<OperationState>(emptyOperation);
  const [confirmState, setConfirmState] = useState<OperationState>(emptyOperation);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const confirmDialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const hasUnsavedReview = reviewDirty;

  const loadStudents = useCallback(async (signal?: AbortSignal) => {
    setStudentLoading(true);
    setStudentLoadError("");
    try {
      const data = await requestJson<{ students?: Row[] }>("/api/students", { signal });
      if (!data) throw new HttpError(200, "学生名单响应不完整，请重试");
      setStudents(data.students || []);
    } catch (reason) {
      if (!signal?.aborted) setStudentLoadError(errorMessage(reason, "暂时无法读取学生名单"));
    } finally {
      if (!signal?.aborted) setStudentLoading(false);
    }
  }, []);

  const loadAssessments = useCallback(async (signal?: AbortSignal) => {
    setAssessmentLoading(true);
    setAssessmentLoadError("");
    try {
      const data = await requestJson<{ assessments?: Row[] }>("/api/assessments", { signal });
      if (!data) throw new HttpError(200, "测验列表响应不完整，请重试");
      setAssessments(data.assessments || []);
    } catch (reason) {
      if (!signal?.aborted) setAssessmentLoadError(errorMessage(reason, "暂时无法读取测验列表"));
    } finally {
      if (!signal?.aborted) setAssessmentLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudents(controller.signal);
    return () => controller.abort();
  }, [loadStudents]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAssessments(controller.signal);
    return () => controller.abort();
  }, [loadAssessments]);

  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedReview) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const protectNavigation = (event: MouseEvent) => {
      if (!hasUnsavedReview || !(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      const href = link?.getAttribute("href") || "";
      if (!link || !href || href.startsWith("#") || link.target === "_blank") return;
      if (!window.confirm("当前有未保存校对内容，确定离开吗？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", protectUnsaved);
    document.addEventListener("click", protectNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", protectUnsaved);
      document.removeEventListener("click", protectNavigation, true);
    };
  }, [hasUnsavedReview]);

  useEffect(() => {
    if (!confirmDialogOpen) return;
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusables[0] || dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const current = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [confirmDialogOpen]);

  const studentRows = useMemo(() => students.filter((row) => row.name), [students]);
  const assessmentRows = useMemo(() => assessments.filter((row) => row.title), [assessments]);

  const selectionIssues = useMemo(() => {
    const issues: string[] = [];
    if (!studentId) issues.push("请选择学生");
    if (!assessmentId) issues.push("请选择测验");
    if (ocrMeta && !studentSelectionReviewed) issues.push("学生归属尚未人工核对");
    if (ocrMeta && !assessmentSelectionReviewed) issues.push("测验归属尚未人工核对");
    return issues;
  }, [assessmentId, assessmentSelectionReviewed, ocrMeta, studentId, studentSelectionReviewed]);

  const reviewSummary = useMemo(() => {
    const totalScore = items.reduce((sum, item) => {
      const score = item.teacherScore.trim() ? Number(item.teacherScore) : NaN;
      return Number.isFinite(score) ? sum + score : sum;
    }, 0);
    const uncertainCount = items.filter((item) => !itemIsReady(item)).length;
    const pendingCount = items.filter((item) => item.reviewStatus !== "confirmed").length;
    return { questionCount: items.length, totalScore, uncertainCount, pendingCount };
  }, [items]);

  const confirmationBlockers = useMemo(() => {
    const blockers = [...selectionIssues];
    if (!items.length) blockers.push("尚未生成题目");
    items.forEach((item, index) => {
      if (!itemIsReady(item)) blockers.push(`第${item.questionNumber || index + 1}题仍需校对或确认`);
    });
    if (hasUnsavedReview) blockers.push("存在未保存的校对内容");
    return blockers;
  }, [hasUnsavedReview, items, selectionIssues]);

  const resetRecognition = () => {
    setAssetId(null);
    setOcrText("");
    setOcrMeta(null);
    setItems([]);
    setJobId(null);
    setReviewDirty(false);
    setOcrProgress(0);
    setOcrState(emptyOperation());
    setSaveState(emptyOperation());
    setConfirmState(emptyOperation());
    setStudentSelectionReviewed(false);
    setAssessmentSelectionReviewed(false);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] || null;
    if (hasUnsavedReview && !window.confirm("当前有未保存校对内容，确定替换答题卡吗？")) {
      event.currentTarget.value = "";
      return;
    }
    const error = validateRecognitionFile(nextFile);
    if (error) {
      setFile(null);
      setUploadState({ status: "error", error });
      return;
    }
    setFile(nextFile);
    resetRecognition();
    setUploadState(emptyOperation());
    setMessage("");
  };

  const uploadOriginal = async () => {
    if (uploadState.status === "loading") return;
    if (uploadState.status === "success") return;
    if (!studentId || !assessmentId) {
      setUploadState({ status: "error", error: "请先选择学生与测验" });
      return;
    }
    const error = validateRecognitionFile(file);
    if (error || !file) {
      setUploadState({ status: "error", error: error || "文件不能为空" });
      return;
    }
    setUploadState({ status: "loading" });
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "answer-card");
      const data = await requestJson<{ id?: number; name?: string }>("/api/files", { method: "POST", body });
      if (!data?.id) throw new HttpError(200, "原图保存响应不完整，请重试");
      setAssetId(Number(data.id));
      setUploadState({ status: "success" });
      setOcrState(emptyOperation());
      setMessage("原图已保存。下一步将在本机浏览器运行 OCR，不会发送到外部服务。");
    } catch (reason) {
      setUploadState({ status: "error", error: errorMessage(reason, "原图上传失败，请重试") });
    } finally {
      setUploadState((current) => current.status === "loading" ? { status: "error", error: "原图上传失败，请重试" } : current);
    }
  };

  const runOcr = async () => {
    if (ocrState.status === "loading") return;
    if (!file || !assetId) {
      setOcrState({ status: "error", error: "请先成功上传原图" });
      return;
    }
    setOcrState({ status: "loading" });
    setOcrProgress(0);
    setMessage("");
    try {
      const result = await recognizeChineseImage(file, (event) => setOcrProgress(Math.round(event.progress * 100)));
      const studentCandidates = studentRows.filter((row) => result.text.includes(row.name || "")).sort((a, b) => (b.name || "").length - (a.name || "").length);
      const assessmentCandidates = assessmentRows.filter((row) => result.text.includes(row.title || "")).sort((a, b) => (b.title || "").length - (a.title || "").length);
      const parsed = parseAnswerCardOcr(
        result.text,
        studentRows.map((row) => ({ id: row.id, name: row.name || "" })),
        assessmentRows.map((row) => ({ id: row.id, title: row.title || "" })),
        result.confidence,
      );
      setOcrText(result.text);
      setOcrMeta({
        assessmentTitle: parsed.assessmentTitle || "",
        date: parsed.date || "",
        totalScore: parsed.totalScore,
        confidence: result.confidence,
        studentId: parsed.studentId,
        studentName: parsed.studentName || "",
        assessmentId: parsed.assessmentId,
        studentCandidates: studentCandidates.map((row) => row.name || ""),
        assessmentCandidates: assessmentCandidates.map((row) => row.title || ""),
      });
      setItems(normalizeItems(parsed.items));
      setReviewDirty(true);
      setStudentSelectionReviewed(false);
      setAssessmentSelectionReviewed(false);
      setOcrState({ status: "success" });
      setMessage(`本机 OCR 已完成（约${Math.round(result.confidence * 100)}%），结果仅作初步识别，请逐题校对。`);
    } catch (reason) {
      setOcrState({ status: "error", error: errorMessage(reason, "本机 OCR 失败，请重试") });
    } finally {
      setOcrState((current) => current.status === "loading" ? { status: "error", error: "本机 OCR 失败，请重试" } : current);
    }
  };

  const updateItem = (index: number, patch: Partial<Item>) => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setReviewDirty(true);
  };

  const confirmItem = (index: number, checked: boolean) => {
    updateItem(index, checked ? { reviewStatus: "confirmed", candidates: [], errorType: "" } : { reviewStatus: "pending" });
  };

  const addItem = () => {
    if (jobId || saveState.status === "loading") return;
    setItems((current) => [...current, blankItem(current.length + 1)]);
    setReviewDirty(true);
  };

  const saveReview = async () => {
    if (saveState.status === "loading") return;
    if (!assetId || !studentId || !assessmentId) {
      setSaveState({ status: "error", error: "请先完成学生、测验和原图关联" });
      return;
    }
    if (!items.length) {
      setSaveState({ status: "error", error: "至少需要一题才能保存校对" });
      return;
    }
    setSaveState({ status: "loading" });
    setMessage("");
    let saved = false;
    try {
      const payloadItems = items.map((item) => ({
        id: item.id,
        questionNumber: item.questionNumber.trim(),
        studentAnswer: item.studentAnswer.trim(),
        standardAnswer: item.standardAnswer.trim(),
        teacherScore: item.teacherScore.trim() ? Number(item.teacherScore) : null,
        maxScore: item.maxScore.trim() ? Number(item.maxScore) : null,
        knowledgePoints: item.knowledgePoints.trim(),
        confidence: item.confidence,
        candidates: item.candidates,
        errorType: item.errorType,
        reviewStatus: item.reviewStatus,
      }));
      if (!jobId) {
        const created = await requestJson<{ id?: number }>("/api/recognition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", studentId: Number(studentId), assessmentId: Number(assessmentId), sourceAssetId: assetId, items: payloadItems }),
        });
        if (!created?.id) throw new HttpError(200, "校对任务响应不完整，请重试");
        setJobId(Number(created.id));
        const detail = await requestJson<{ items?: unknown[] }>(`/api/recognition?id=${created.id}`);
        setItems(normalizeItems(detail?.items || items));
      } else {
        const updates = payloadItems.filter((item): item is typeof item & { id: number } => Number.isFinite(item.id));
        if (updates.length !== payloadItems.length) throw new HttpError(400, "题目编号不完整，请刷新后重试");
        await requestJson("/api/recognition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", jobId, progress: 80, items: updates }),
        });
      }
      setReviewDirty(false);
      setMessage("逐题校对已保存；教师最终确认前不会写入正式成绩或学情。");
      saved = true;
    } catch (reason) {
      setSaveState({ status: "error", error: errorMessage(reason, "保存校对失败，请重试") });
    } finally {
      setSaveState((current) => saved ? { status: "success" } : current);
    }
  };

  const openConfirmDialog = () => {
    if (confirmState.status === "loading") return;
    if (confirmationBlockers.length) {
      setConfirmState({ status: "error", error: `暂不能确认：${confirmationBlockers[0]}` });
      return;
    }
    setConfirmState(emptyOperation());
    setConfirmDialogOpen(true);
  };

  const performConfirm = async () => {
    if (confirmState.status === "loading") return;
    if (!jobId) return;
    setConfirmDialogOpen(false);
    setConfirmState({ status: "loading" });
    setMessage("");
    let confirmed = false;
    try {
      const data = await requestJson<{ ok?: boolean; score?: number; count?: number; alreadyConfirmed?: boolean }>("/api/recognition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", jobId }),
      });
      if (!data?.ok) throw new HttpError(200, "确认响应不完整，请重试");
      confirmed = true;
      setReviewDirty(false);
      setMessage(data.alreadyConfirmed ? "该任务已经确认过，未重复写入成绩。" : `教师已确认${data.count || 0}题，总分${data.score ?? "—"}，正式成绩与学情已写入。`);
    } catch (reason) {
      setConfirmState({ status: "error", error: errorMessage(reason, "最终确认失败，请重试") });
    } finally {
      setConfirmState((current) => confirmed ? { status: "success" } : current);
    }
  };

  const currentStage = confirmState.status === "success" ? 5 : jobId ? 4 : ocrState.status === "success" ? 4 : assetId ? 2 : 1;
  const canUpload = Boolean(studentId && assessmentId && file && uploadState.status !== "loading" && uploadState.status !== "success");
  const canSave = Boolean(assetId && ocrState.status === "success" && saveState.status !== "loading");

  return (
    <AppShell title="答题卡 OCR 校对" subtitle="本机 OCR 只作初步识别；原图保留、存疑必核、教师确认后才进入正式成绩">
      <div className={styles.page}>
        {message && <div className={styles.notice} role="status">{message}</div>}

        <nav className={styles.stepper} aria-label="答题卡处理步骤">
          {steps.map((label, index) => {
            const number = index + 1;
            const complete = currentStage > number || (number === 1 && Boolean(studentId && assessmentId));
            return (
              <div className={`${styles.step} ${complete ? styles.stepComplete : ""} ${currentStage === number ? styles.stepActive : ""}`} key={label}>
                <span className={styles.stepNumber}>{complete ? "✓" : number}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </nav>

        <section className={styles.card} aria-labelledby="selection-title">
          <div className={styles.cardHeading}><div><p className={styles.eyebrow}>第 1 步 / 选择范围</p><h2 id="selection-title">先关联学生与测验</h2></div><span className={styles.helpText}>OCR 不会替教师决定归属</span></div>
          <div className={styles.selectionGrid}>
            <label>
              学生
              <select value={studentId} aria-label="选择学生" onChange={(event) => { setStudentId(event.target.value); setStudentSelectionReviewed(Boolean(ocrMeta)); }}>
                <option value="">请选择学生</option>
                {studentRows.map((row) => <option key={row.id} value={row.id}>{rowLabel(row, "name")}</option>)}
              </select>
            </label>
            <label>
              测验
              <select value={assessmentId} aria-label="选择测验" onChange={(event) => { setAssessmentId(event.target.value); setAssessmentSelectionReviewed(Boolean(ocrMeta)); }}>
                <option value="">请选择测验</option>
                {assessmentRows.map((row) => <option key={row.id} value={row.id}>{rowLabel(row, "title")}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.loadStates}>
            {studentLoading && <span className={styles.helpText}>正在读取学生名单…</span>}
            {studentLoadError && <div className={styles.errorRow} role="alert"><span>学生名单读取失败：{studentLoadError}</span><button type="button" onClick={() => void loadStudents()}>重新读取学生名单</button></div>}
            {assessmentLoading && <span className={styles.helpText}>正在读取测验列表…</span>}
            {assessmentLoadError && <div className={styles.errorRow} role="alert"><span>测验列表读取失败：{assessmentLoadError}</span><button type="button" onClick={() => void loadAssessments()}>重新读取测验</button></div>}
          </div>
          {ocrMeta && (
            <div className={styles.ocrMatchPanel}>
              <strong>OCR 归属提示仅供核对</strong>
              <span>学生候选：{ocrMeta.studentCandidates.join("、") || "【存疑】未识别"}</span>
              <span>测验候选：{ocrMeta.assessmentCandidates.join("、") || ocrMeta.assessmentTitle || "【存疑】未识别"}</span>
              <label className={styles.checkboxRow}><input type="checkbox" checked={studentSelectionReviewed} onChange={(event) => setStudentSelectionReviewed(event.target.checked)} />我已核对学生归属</label>
              <label className={styles.checkboxRow}><input type="checkbox" checked={assessmentSelectionReviewed} onChange={(event) => setAssessmentSelectionReviewed(event.target.checked)} />我已核对测验归属</label>
            </div>
          )}
        </section>

        <section className={styles.card} aria-labelledby="upload-title">
          <div className={styles.cardHeading}><div><p className={styles.eyebrow}>第 2 步 / 上传原图</p><h2 id="upload-title">上传答题卡原图</h2></div><span className={styles.helpText}>仅支持 JPG、PNG、WebP；最大 25MB</span></div>
          <label className={styles.filePicker}>
            选择答题卡图片
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} />
          </label>
          {file && <p className={styles.fileMeta}>{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
          {uploadState.status === "error" && <div className={styles.operationError} role="alert"><span>{uploadState.error}</span><button type="button" onClick={() => void uploadOriginal()}>重试上传</button></div>}
          {uploadState.status === "success" && <p className={styles.successText}>原图保存成功，尚未开始 OCR。</p>}
          <button className={styles.primaryButton} type="button" disabled={!canUpload} onClick={() => void uploadOriginal()}>{uploadState.status === "loading" ? "上传中…" : uploadState.status === "success" ? "原图已上传" : "上传原图"}</button>
        </section>

        {assetId && (
          <section className={styles.card} aria-labelledby="ocr-title">
            <div className={styles.cardHeading}><div><p className={styles.eyebrow}>第 3 步 / 本机 OCR</p><h2 id="ocr-title">在本机浏览器识别</h2></div><span className={styles.helpText}>不调用外部 OCR，不把图片发出浏览器</span></div>
            <p className={styles.explanation}>识别结果是初步草稿。低置信、缺失或冲突字段会标为“存疑”，必须逐题处理。</p>
            {ocrState.status === "error" && <div className={styles.operationError} role="alert"><span>{ocrState.error}</span><button type="button" onClick={() => void runOcr()}>重试OCR</button></div>}
            {ocrState.status === "success" && ocrMeta && <div className={styles.ocrSummary}><span>整体置信度：{Math.round(ocrMeta.confidence * 100)}%</span><span>识别考试：{ocrMeta.assessmentTitle || "【存疑】"}</span><span>日期：{ocrMeta.date || "【存疑】"}</span><span>总分：{ocrMeta.totalScore ?? "【存疑】"}</span></div>}
            {ocrState.status === "loading" && <div className={styles.progress} role="status"><span>本机识别中 {ocrProgress}%</span><div><i style={{ width: `${ocrProgress}%` }} /></div></div>}
            <button className={styles.secondaryButton} type="button" disabled={ocrState.status === "loading"} onClick={() => void runOcr()}>{ocrState.status === "loading" ? "本机识别中…" : ocrState.status === "success" ? "重新运行 OCR" : "开始本机 OCR"}</button>
            {ocrText && <details className={styles.rawText}><summary>查看 OCR 原文（只用于核对）</summary><pre>{ocrText}</pre></details>}
          </section>
        )}

        {assetId && ocrState.status === "success" ? (
          <section className={styles.card} aria-labelledby="review-title">
            <div className={styles.cardHeading}><div><p className={styles.eyebrow}>第 4 步 / 逐题校对</p><h2 id="review-title">逐题确认答案与分数</h2></div><span className={styles.helpText}>{reviewDirty ? "有未保存修改" : jobId ? "校对草稿已保存" : "识别结果尚未保存"}</span></div>
            <div className={styles.summaryGrid} aria-label="校对摘要">
              <div><strong>{reviewSummary.questionCount}</strong><span>题目数量</span></div>
              <div><strong>{Number.isFinite(reviewSummary.totalScore) ? reviewSummary.totalScore : "—"}</strong><span>总分</span></div>
              <div><strong>{reviewSummary.uncertainCount}</strong><span>存疑项数量</span></div>
              <div><strong>{reviewSummary.pendingCount}</strong><span>待教师确认</span></div>
            </div>
            {selectionIssues.length > 0 && <div className={styles.warning} role="alert">{selectionIssues.join("；")}。完成核对后才能保存或最终确认。</div>}
            <div className={styles.reviewToolbar}><p className={styles.helpText}>每题都要明确题号、学生答案、得分、满分、知识点和状态；参考答案为可选补充。</p><button type="button" className={styles.secondaryButton} disabled={Boolean(jobId) || saveState.status === "loading"} onClick={addItem}>＋ 添加题目</button></div>
            <div className={styles.reviewList}>
              {items.map((item, index) => {
                const issues = itemIssues(item);
                const status = item.reviewStatus === "confirmed" && hardItemIssues(item).length === 0 ? "已确认" : issues.length ? "存疑" : "待校对";
                return (
                  <article className={styles.reviewItem} key={item.id || `new-${index}`}>
                    <div className={styles.itemHeading}><strong>第 {index + 1} 题</strong><span className={status === "已确认" ? styles.confirmedBadge : styles.uncertainBadge}>{status}</span></div>
                    <div className={styles.fieldGrid}>
                      <label>题号<span className={styles.fieldState}>{fieldState(item, "questionNumber")}</span><input value={item.questionNumber} onChange={(event) => updateItem(index, { questionNumber: event.target.value })} /></label>
                      <label>学生答案<span className={styles.fieldState}>{fieldState(item, "studentAnswer")}</span><textarea value={item.studentAnswer} onChange={(event) => updateItem(index, { studentAnswer: event.target.value })} /></label>
                      <label>参考答案（可选）<textarea value={item.standardAnswer} onChange={(event) => updateItem(index, { standardAnswer: event.target.value })} /></label>
                      <label>得分<span className={styles.fieldState}>{fieldState(item, "teacherScore")}</span><input type="number" min="0" step="0.1" value={item.teacherScore} onChange={(event) => updateItem(index, { teacherScore: event.target.value })} /></label>
                      <label>满分<span className={styles.fieldState}>{fieldState(item, "maxScore")}</span><input type="number" min="0.1" step="0.1" value={item.maxScore} onChange={(event) => updateItem(index, { maxScore: event.target.value })} /></label>
                      <label>知识点<span className={styles.fieldState}>{fieldState(item, "knowledgePoints")}</span><input value={item.knowledgePoints} onChange={(event) => updateItem(index, { knowledgePoints: event.target.value })} /></label>
                    </div>
                    {isScoreInvalid(item) && <p className={styles.fieldWarning}>分数无效：得分必须是 0 到满分之间的有限数字。</p>}
                    {issues.length > 0 && <p className={styles.issueList}>存疑原因：{issues.join("、")}</p>}
                    <label className={styles.checkboxRow}><input type="checkbox" checked={item.reviewStatus === "confirmed"} onChange={(event) => confirmItem(index, event.target.checked)} />我已人工核对本题，并处理所有存疑项</label>
                  </article>
                );
              })}
            </div>
            {saveState.status === "error" && <div className={styles.operationError} role="alert"><span>{saveState.error}</span><button type="button" onClick={() => void saveReview()}>重试保存校对</button></div>}
            {saveState.status === "success" && <p className={styles.successText}>校对草稿已保存，正式成绩仍未写入。</p>}
            <div className={styles.actionBar}>
              <button className={styles.primaryButton} type="button" disabled={!canSave} onClick={() => void saveReview()}>{saveState.status === "loading" ? "保存校对中…" : "保存校对"}</button>
              <button className={styles.primaryButton} type="button" disabled={!jobId || Boolean(confirmationBlockers.length) || confirmState.status === "loading" || confirmState.status === "success"} onClick={openConfirmDialog}>{confirmState.status === "loading" ? "确认中…" : "教师最终确认"}</button>
            </div>
            {confirmState.status === "error" && <div className={styles.operationError} role="alert"><span>{confirmState.error}</span><button type="button" onClick={openConfirmDialog}>重试最终确认</button></div>}
            {confirmState.status === "success" && <p className={styles.successText}>该任务已完成最终确认。</p>}
          </section>
        ) : (
          <EmptyState title={assetId ? "请先运行本机 OCR" : "尚未上传答题卡原图"} description={assetId ? "OCR 完成后才会进入逐题校对。" : "完成学生、测验选择并上传本地合成测试图片后，才会建立校对草稿。"} />
        )}

        {confirmDialogOpen && (
          <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDialogOpen(false); }}>
            <section className={styles.confirmDialog} ref={(node) => { confirmDialogRef.current = node; }} role="dialog" aria-modal="true" aria-labelledby="recognition-confirm-title" tabIndex={-1}>
              <div className={styles.cardHeading}><div><p className={styles.eyebrow}>第 5 步 / 教师最终确认</p><h2 id="recognition-confirm-title">确认后写入正式成绩</h2></div><button type="button" aria-label="关闭确认对话框" onClick={() => setConfirmDialogOpen(false)}>×</button></div>
              <p>请再次核对以下摘要。确认后才会写入正式成绩和学情证据，OCR 草稿本身不会产生正式记录。</p>
              <div className={styles.confirmSummary}><span>题目数量 <strong>{reviewSummary.questionCount}</strong></span><span>总分 <strong>{reviewSummary.totalScore}</strong></span><span>存疑项数量 <strong>{reviewSummary.uncertainCount}</strong></span></div>
              <div className={styles.actionBar}><button type="button" className={styles.secondaryButton} onClick={() => setConfirmDialogOpen(false)}>返回继续校对</button><button type="button" className={styles.primaryButton} disabled={confirmState.status === "loading"} onClick={() => void performConfirm()}>{confirmState.status === "loading" ? "确认中…" : "确认并写入正式成绩"}</button></div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
