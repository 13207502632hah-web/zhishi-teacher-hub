"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { validateAssessmentResult } from "../lib/assessment";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./exam-projects.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";

type Project = Record<string, unknown> & {
  id: number;
  academicYear: string;
  name: string;
  category: string;
  grade: string;
  examDate: string;
  totalScore: number;
  studentCount: number;
  recordedCount: number;
};

type Student = Record<string, unknown> & {
  studentId: number;
  name: string;
  grade: string;
  school: string;
  status: string;
  score: string;
  objectiveScore: string;
  subjectiveScore: string;
  teacherNote: string;
};

type Analytics = {
  summary: {
    recorded: number;
    averageScore: number | null;
    averageRate: number | null;
    volatility: number | null;
  };
  questions: Array<{
    questionNumber: string;
    maxScore: number | null;
    averageScore: number | null;
    correctRate: number | null;
    knowledgePoints: string;
    errorType: string;
    count: number;
  }>;
  dataStatus: string;
};

type ScoreKey = "score" | "objectiveScore" | "subjectiveScore";

type ProjectResponse = { projects?: Array<Record<string, unknown>> };
type ResultsResponse = { project?: Record<string, unknown>; students?: Array<Record<string, unknown>> };
type AnalyticsResponse = {
  summary?: {
    recorded?: unknown;
    averageScore?: unknown;
    averageRate?: unknown;
    volatility?: unknown;
  };
  questions?: Array<Record<string, unknown>>;
  dataStatus?: string;
};

const currentAcademicYear = () => {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
};

const numberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNumber = (value: unknown) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const editableValue = (value: unknown) => value == null ? "" : String(value);

const normalizeProject = (value: Record<string, unknown>): Project => ({
  ...value,
  id: numberOr(value.id, 0),
  academicYear: String(value.academicYear ?? value.academic_year ?? ""),
  name: String(value.name || "未命名考试项目"),
  category: String(value.category || "考试"),
  grade: String(value.grade || "年级待补"),
  examDate: String(value.examDate ?? value.exam_date ?? ""),
  totalScore: numberOr(value.totalScore ?? value.total_score, 100),
  studentCount: numberOr(value.studentCount, 0),
  recordedCount: numberOr(value.recordedCount, 0),
});

const normalizeStudent = (value: Record<string, unknown>): Student => ({
  ...value,
  studentId: numberOr(value.studentId ?? value.student_id, 0),
  name: String(value.name || "未命名学生"),
  grade: String(value.grade || "年级待补"),
  school: String(value.school || ""),
  status: String(value.status || "pending"),
  score: editableValue(value.score),
  objectiveScore: editableValue(value.objectiveScore ?? value.objective_score),
  subjectiveScore: editableValue(value.subjectiveScore ?? value.subjective_score),
  teacherNote: editableValue(value.teacherNote ?? value.teacher_note),
});

const normalizeAnalytics = (value: AnalyticsResponse): Analytics => ({
  summary: {
    recorded: numberOr(value.summary?.recorded, 0),
    averageScore: nullableNumber(value.summary?.averageScore),
    averageRate: nullableNumber(value.summary?.averageRate),
    volatility: nullableNumber(value.summary?.volatility),
  },
  questions: (value.questions || []).map((question) => ({
    questionNumber: String(question.questionNumber ?? question.question_number ?? "—"),
    maxScore: nullableNumber(question.maxScore ?? question.max_score),
    averageScore: nullableNumber(question.averageScore ?? question.average_score),
    correctRate: nullableNumber(question.correctRate ?? question.correct_rate),
    knowledgePoints: String(question.knowledgePoints ?? question.knowledge_points ?? ""),
    errorType: String(question.errorType ?? question.error_type ?? ""),
    count: numberOr(question.count, 0),
  })),
  dataStatus: String(value.dataStatus || "数据不足"),
});

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError || reason instanceof Error ? reason.message : fallback;

const isAcademicYear = (value: string) => {
  const match = value.match(/^(20\d{2})-(20\d{2})$/);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
};

const parseScore = (value: string) => value.trim() === "" ? null : Number(value);

export default function ExamProjectsPage() {
  const [draftAcademicYear, setDraftAcademicYear] = useState(currentAcademicYear);
  const [appliedAcademicYear, setAppliedAcademicYear] = useState(currentAcademicYear);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectLoadState, setProjectLoadState] = useState<LoadState>("loading");
  const [projectLoadError, setProjectLoadError] = useState("");
  const [projectReloadKey, setProjectReloadKey] = useState(0);
  const [grade, setGrade] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Project | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [resultsLoadState, setResultsLoadState] = useState<LoadState>("idle");
  const [resultsLoadError, setResultsLoadError] = useState("");
  const [resultsReloadKey, setResultsReloadKey] = useState(0);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsLoadState, setAnalyticsLoadState] = useState<LoadState>("idle");
  const [analyticsLoadError, setAnalyticsLoadError] = useState("");
  const [analyticsReloadKey, setAnalyticsReloadKey] = useState(0);
  const [resultsBaseline, setResultsBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");

  const selectedId = selected?.id ?? null;
  const resultsDirty = Boolean(resultsBaseline && JSON.stringify(students) !== resultsBaseline);

  const showMessage = useCallback((nextMessage: string, tone: "info" | "success" | "error" = "info") => {
    setMessage(nextMessage);
    setMessageTone(tone);
  }, []);

  const resetSelectedData = useCallback(() => {
    setSelected(null);
    setStudents([]);
    setAnalytics(null);
    setResultsBaseline("");
    setResultsLoadState("idle");
    setResultsLoadError("");
    setAnalyticsLoadState("idle");
    setAnalyticsLoadError("");
  }, []);

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    setProjectLoadState("loading");
    setProjectLoadError("");
    try {
      const data = await requestJson<ProjectResponse>(`/api/exam-projects?academicYear=${appliedAcademicYear}`, {
        signal,
        cache: "no-store",
      });
      if (!data) throw new HttpError(200, "考试项目接口没有返回数据，请重试");
      setProjects((data.projects || []).map(normalizeProject).filter((item) => item.id > 0));
      setProjectLoadState("ready");
    } catch (reason) {
      if (!signal?.aborted) {
        setProjectLoadError(errorMessage(reason, "暂时无法读取考试项目"));
        setProjectLoadState("error");
      }
    }
  }, [appliedAcademicYear]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(controller.signal);
    return () => controller.abort();
  }, [loadProjects, projectReloadKey]);

  const loadResults = useCallback(async (signal?: AbortSignal) => {
    if (!selectedId) return;
    setResultsLoadState("loading");
    setResultsLoadError("");
    try {
      const data = await requestJson<ResultsResponse>(`/api/exam-projects/${selectedId}/results`, {
        signal,
        cache: "no-store",
      });
      if (!data?.project) throw new HttpError(200, "成绩接口响应不完整，请重试");
      const normalizedProject = normalizeProject(data.project);
      const nextStudents = (data.students || []).map(normalizeStudent).filter((item) => item.studentId > 0);
      setSelected((current) => current?.id === selectedId ? { ...current, ...normalizedProject } : current);
      setStudents(nextStudents);
      setResultsBaseline(JSON.stringify(nextStudents));
      setResultsLoadState("ready");
    } catch (reason) {
      if (!signal?.aborted) {
        setResultsLoadError(errorMessage(reason, "暂时无法读取全体成绩"));
        setResultsLoadState("error");
      }
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void loadResults(controller.signal);
    return () => controller.abort();
  }, [loadResults, resultsReloadKey, selectedId]);

  const loadAnalytics = useCallback(async (signal?: AbortSignal) => {
    if (!selectedId) return;
    setAnalyticsLoadState("loading");
    setAnalyticsLoadError("");
    try {
      const data = await requestJson<AnalyticsResponse>(`/api/exam-projects/${selectedId}/analytics`, {
        signal,
        cache: "no-store",
      });
      if (!data) throw new HttpError(200, "统计接口没有返回数据，请重试");
      setAnalytics(normalizeAnalytics(data));
      setAnalyticsLoadState("ready");
    } catch (reason) {
      if (!signal?.aborted) {
        setAnalyticsLoadError(errorMessage(reason, "暂时无法读取统计依据"));
        setAnalyticsLoadState("error");
      }
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void loadAnalytics(controller.signal);
    return () => controller.abort();
  }, [analyticsReloadKey, loadAnalytics, selectedId]);

  useEffect(() => {
    if (!resultsDirty) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [resultsDirty]);

  const grades = useMemo(() => [...new Set(projects.map((item) => item.grade))], [projects]);
  const categories = useMemo(() => [...new Set(projects.map((item) => item.category))], [projects]);
  const visibleProjects = useMemo(
    () => projects.filter((item) => (!grade || item.grade === grade) && (!category || item.category === category)),
    [category, grade, projects],
  );

  const scoreIssues = useMemo<Record<number, string>>(() => {
    if (!selected) return {};
    const issues: Record<number, string> = {};
    for (const student of students) {
      const issue = validateAssessmentResult({
        score: parseScore(student.score),
        objectiveScore: parseScore(student.objectiveScore),
        subjectiveScore: parseScore(student.subjectiveScore),
      }, selected.totalScore);
      if (issue) issues[student.studentId] = issue;
    }
    return issues;
  }, [selected, students]);

  const pendingCount = useMemo(
    () => students.filter((student) => student.score.trim() === "").length,
    [students],
  );
  const recordedCount = students.length - pendingCount;
  const saveScope = selected
    ? `全体 ${students.length} 名（已录 ${recordedCount} 名，待录 ${pendingCount} 名）`
    : "尚未选择考试项目";

  const applyAcademicYear = useCallback(() => {
    const next = draftAcademicYear.trim();
    if (!isAcademicYear(next)) {
      showMessage("学年格式应为 2025-2026，且结束年份必须比开始年份大 1", "error");
      return;
    }
    if (next === appliedAcademicYear) {
      showMessage("学年没有变化，未重复读取考试项目", "info");
      return;
    }
    if (resultsDirty && !window.confirm("当前成绩有未保存修改，切换学年会放弃这些修改。确认继续吗？")) return;
    setAppliedAcademicYear(next);
    setGrade("");
    setCategory("");
    resetSelectedData();
    showMessage(`已应用学年 ${next}，正在读取考试项目…`);
  }, [appliedAcademicYear, draftAcademicYear, resetSelectedData, resultsDirty, showMessage]);

  const resetAcademicYear = useCallback(() => {
    const next = currentAcademicYear();
    setDraftAcademicYear(next);
    if (next === appliedAcademicYear) {
      showMessage("已经是当前学年，未重复读取考试项目", "info");
      return;
    }
    if (resultsDirty && !window.confirm("当前成绩有未保存修改，切换学年会放弃这些修改。确认继续吗？")) return;
    setAppliedAcademicYear(next);
    setGrade("");
    setCategory("");
    resetSelectedData();
    showMessage(`已重置为 ${next}，正在读取考试项目…`);
  }, [appliedAcademicYear, resetSelectedData, resultsDirty, showMessage]);

  const generateTemplate = useCallback(async () => {
    if (generating || saving) return;
    const year = draftAcademicYear.trim();
    if (!isAcademicYear(year)) {
      showMessage("请先输入有效学年，例如 2025-2026", "error");
      return;
    }
    const confirmed = window.confirm(
      `将生成 ${year} 学年模板。该操作是幂等的：重复执行只会补齐缺失项目和学生，不会重复创建已有记录。确认继续吗？`,
    );
    if (!confirmed) return;

    setGenerating(true);
    setMessage("");
    try {
      const data = await requestJson<{ projectCount?: number; gradeCount?: number }>("/api/exam-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academicYear: year }),
      });
      if (!data) throw new HttpError(200, "生成接口没有返回处理结果，请重试");
      setDraftAcademicYear(year);
      if (year !== appliedAcademicYear) {
        setAppliedAcademicYear(year);
        setGrade("");
        setCategory("");
        resetSelectedData();
      } else {
        setProjectReloadKey((value) => value + 1);
      }
      showMessage(`已生成/补齐 ${data.projectCount ?? 0} 个考试项目；重复执行不会重复。`, "success");
    } catch (reason) {
      showMessage(errorMessage(reason, "生成模板失败；未执行后续刷新"), "error");
    } finally {
      setGenerating(false);
    }
  }, [appliedAcademicYear, draftAcademicYear, generating, resetSelectedData, saving, showMessage]);

  const openProject = useCallback((project: Project) => {
    if (project.id === selectedId) return;
    if (resultsDirty && !window.confirm("当前成绩有未保存修改，切换考试项目会放弃这些修改。确认继续吗？")) return;
    setSelected(project);
    setStudents([]);
    setAnalytics(null);
    setResultsBaseline("");
    setResultsLoadState("idle");
    setResultsLoadError("");
    setAnalyticsLoadState("idle");
    setAnalyticsLoadError("");
    setMessage("");
  }, [resultsDirty, selectedId]);

  const updateStudent = useCallback((studentId: number, key: ScoreKey, value: string) => {
    setStudents((items) => items.map((item) => item.studentId === studentId ? { ...item, [key]: value } : item));
    setMessage("");
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    if (!selected || resultsLoadState !== "ready") return;
    if (Object.keys(scoreIssues).length) {
      showMessage(`有 ${Object.keys(scoreIssues).length} 名学生的分数需要修正：${Object.values(scoreIssues)[0]}`, "error");
      return;
    }
    if (!resultsDirty) {
      showMessage("当前没有未保存修改", "info");
      return;
    }

    setSaving(true);
    setMessage("");
    const payload = students.map((student) => ({
      studentId: student.studentId,
      score: student.score.trim() === "" ? "" : Number(student.score),
      objectiveScore: student.objectiveScore.trim() === "" ? "" : Number(student.objectiveScore),
      subjectiveScore: student.subjectiveScore.trim() === "" ? "" : Number(student.subjectiveScore),
      teacherNote: student.teacherNote,
    }));
    try {
      const data = await requestJson<{ updated?: number }>(`/api/exam-projects/${selected.id}/results`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: payload }),
      });
      if (!data) throw new HttpError(200, "保存接口没有返回处理结果，请重试");
      const savedSnapshot = JSON.stringify(students);
      setResultsBaseline(savedSnapshot);
      setProjectReloadKey((value) => value + 1);
      setResultsReloadKey((value) => value + 1);
      setAnalyticsReloadKey((value) => value + 1);
      showMessage(`已保存 ${data.updated ?? payload.length} 名学生；${pendingCount} 名空白成绩仍为待录。`, "success");
    } catch (reason) {
      showMessage(`${errorMessage(reason, "保存全体成绩失败")}；未保存修改仍保留在表格中。`, "error");
    } finally {
      setSaving(false);
    }
  }, [pendingCount, resultsDirty, resultsLoadState, saving, scoreIssues, selected, showMessage, students]);

  return (
    <AppShell
      title="考试项目"
      subtitle="按学年统一查看考试项目、全体成绩和统计依据；空白成绩始终保留为待录"
      actions={(
        <button className={styles.primaryButton} type="button" disabled={generating || saving} onClick={() => void generateTemplate()}>
          {generating ? "正在生成…" : "生成本学年模板"}
        </button>
      )}
    >
      <div className={styles.page}>
        {message && <div className={`${styles.notice} ${styles[`notice${messageTone[0].toUpperCase()}${messageTone.slice(1)}`]}`} role="status">{message}</div>}

        <section className={styles.filterPanel} aria-labelledby="exam-project-filter-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>范围</span>
              <h2 id="exam-project-filter-title">先选学年，再查看项目</h2>
              <p>学年只在点击“应用学年”后读取，年级和考试类别在当前结果内筛选。</p>
            </div>
            <span className={styles.appliedTag}>已应用：{appliedAcademicYear}</span>
          </div>
          <div className={styles.filterGrid} role="group" aria-label="考试项目筛选">
            <label className={styles.field}>
              <span>学年</span>
              <input
                value={draftAcademicYear}
                onChange={(event) => setDraftAcademicYear(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") applyAcademicYear(); }}
                inputMode="numeric"
                aria-label="待应用学年"
              />
            </label>
            <button className={styles.secondaryButton} type="button" onClick={applyAcademicYear}>应用学年</button>
            <button className={styles.linkButton} type="button" onClick={resetAcademicYear}>重置学年</button>
            <label className={styles.field}>
              <span>年级</span>
              <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                <option value="">全部年级</option>
                {grades.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>考试类别</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">全部类别</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={styles.projectSection} aria-labelledby="exam-project-list-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>项目列表</span>
              <h2 id="exam-project-list-title">本学年考试项目</h2>
              <p>选择一个项目后，成绩表和统计依据会分别加载，互不阻塞。</p>
            </div>
            <span className={styles.countTag}>{projectLoadState === "ready" ? `${visibleProjects.length} 个项目` : "—"}</span>
          </div>

          {projectLoadState === "loading" && <div className={styles.stateBlock} role="status">正在读取考试项目…</div>}
          {projectLoadState === "error" && (
            <div className={styles.errorBlock} role="alert">
              <div><strong>考试项目读取失败</strong><p>{projectLoadError}</p></div>
              <button className={styles.secondaryButton} type="button" onClick={() => setProjectReloadKey((value) => value + 1)}>重新读取考试项目</button>
            </div>
          )}
          {projectLoadState === "ready" && visibleProjects.length === 0 && (
            <div className={styles.emptyState}>
              <span aria-hidden="true">＋</span>
              <h3>本学年还没有考试项目</h3>
              <p>可先生成模板。执行前会说明幂等含义并再次确认；没有演示数据时不会伪造项目或统计。</p>
              <button className={styles.primaryButton} type="button" disabled={generating || saving} onClick={() => void generateTemplate()}>
                生成本学年模板
              </button>
            </div>
          )}
          {projectLoadState === "ready" && visibleProjects.length > 0 && (
            <div className={styles.projectGrid}>
              {visibleProjects.map((project) => {
                const progress = project.studentCount > 0 ? Math.min(100, project.recordedCount / project.studentCount * 100) : 0;
                return (
                  <button
                    className={`${styles.projectCard} ${selectedId === project.id ? styles.projectCardActive : ""}`}
                    type="button"
                    key={project.id}
                    aria-pressed={selectedId === project.id}
                    onClick={() => openProject(project)}
                  >
                    <span className={styles.cardMeta}>{project.grade} · {project.category}</span>
                    <strong>{project.name}</strong>
                    <span className={styles.cardDetail}>{project.examDate || "考试日期待补"} · 总分 {project.totalScore}</span>
                    <span className={styles.progressLabel}><b>{project.recordedCount}/{project.studentCount}</b> 已录</span>
                    <span className={styles.progressTrack} aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {selected && (
          <section className={styles.detailSection} aria-labelledby="exam-results-title">
            <div className={styles.detailHeading}>
              <div>
                <span className={styles.eyebrow}>全体成绩录入</span>
                <h2 id="exam-results-title">{selected.name}</h2>
                <p>{selected.grade} · {selected.category} · 总分 {selected.totalScore}</p>
              </div>
              <div className={styles.detailActions}>
                <span className={resultsDirty ? styles.dirtyLabel : styles.savedLabel} role="status">
                  {resultsDirty ? "有未保存修改" : "全部已保存"}
                </span>
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={saving || resultsLoadState !== "ready" || !resultsDirty || Object.keys(scoreIssues).length > 0}
                  onClick={() => void save()}
                >
                  {saving ? "正在保存…" : "保存全体成绩"}
                </button>
              </div>
            </div>

            <div className={styles.saveScope} role="status">
              <strong>保存范围</strong>
              <span>{saveScope}</span>
              <span>空白总分不会写成 0；保存失败时保护未保存成绩。</span>
            </div>

            {resultsLoadState === "loading" && <div className={styles.stateBlock} role="status">正在读取全体成绩…</div>}
            {resultsLoadState === "error" && (
              <div className={styles.errorBlock} role="alert">
                <div><strong>全体成绩读取失败</strong><p>{resultsLoadError}</p></div>
                <button className={styles.secondaryButton} type="button" onClick={() => setResultsReloadKey((value) => value + 1)}>重新读取成绩</button>
              </div>
            )}
            {resultsLoadState === "ready" && students.length === 0 && (
              <div className={styles.emptyState}>
                <span aria-hidden="true">＋</span>
                <h3>当前项目暂无学生成绩行</h3>
                <p>项目没有关联到在读学生时不会生成空白成绩；请先检查学生年级和项目模板。</p>
              </div>
            )}
            {resultsLoadState === "ready" && students.length > 0 && (
              <>
                {Object.keys(scoreIssues).length > 0 && (
                  <div className={styles.validationBlock} role="alert">
                    <strong>请先修正分数</strong>
                    <span>{Object.values(scoreIssues)[0]}；总分、客观题和主观题均只允许在 0 到 {selected.totalScore} 之间，三项齐全时客观题与主观题之和应等于总分。</span>
                  </div>
                )}
                <div className={styles.tableViewport}>
                  <table className={styles.scoreTable}>
                    <caption>全体学生成绩表；横向滚动只发生在此表格区域</caption>
                    <thead>
                      <tr><th scope="col">学生</th><th scope="col">学校</th><th scope="col">总分</th><th scope="col">客观题</th><th scope="col">主观题</th><th scope="col">状态</th></tr>
                    </thead>
                    <tbody>
                      {students.map((student) => {
                        const issue = scoreIssues[student.studentId];
                        const pending = student.score.trim() === "";
                        return (
                          <tr key={student.studentId}>
                            <th scope="row"><span className={styles.studentName}>{student.name}</span><span className={styles.studentGrade}>{student.grade}</span></th>
                            <td>{student.school || "—"}</td>
                            {(["score", "objectiveScore", "subjectiveScore"] as ScoreKey[]).map((key) => (
                              <td key={key}>
                                <input
                                  className={styles.scoreInput}
                                  aria-label={`${student.name}${key === "score" ? "总分" : key === "objectiveScore" ? "客观题" : "主观题"}`}
                                  aria-invalid={Boolean(issue)}
                                  type="number"
                                  inputMode="decimal"
                                  min="0"
                                  max={selected.totalScore}
                                  step="0.01"
                                  value={student[key]}
                                  onChange={(event) => updateStudent(student.studentId, key, event.target.value)}
                                />
                              </td>
                            ))}
                            <td>
                              <span className={issue ? styles.statusError : pending ? styles.statusPending : styles.statusRecorded}>
                                {issue ? "需修正" : pending ? "待录" : "已录"}
                              </span>
                              {issue && <span className={styles.rowHint}>{issue}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <section className={styles.analyticsSection} aria-labelledby="exam-analytics-title">
              <div className={styles.sectionHeading}>
                <div>
                  <span className={styles.eyebrow}>统计依据</span>
                  <h3 id="exam-analytics-title">当前项目统计</h3>
                  <p>只统计已保存且有总分的成绩；样本不足时明确显示“数据不足”。</p>
                </div>
                {analytics?.dataStatus === "数据不足" && <span className={styles.insufficientTag}>数据不足</span>}
              </div>

              {analyticsLoadState === "loading" && <div className={styles.stateBlock} role="status">正在读取统计依据…</div>}
              {analyticsLoadState === "error" && (
                <div className={styles.errorBlock} role="alert">
                  <div><strong>统计依据读取失败</strong><p>{analyticsLoadError}</p></div>
                  <button className={styles.secondaryButton} type="button" onClick={() => setAnalyticsReloadKey((value) => value + 1)}>重新读取统计</button>
                </div>
              )}
              {analyticsLoadState === "ready" && analytics && (
                <>
                  <div className={styles.analyticsGrid}>
                    <article><span>已录人数</span><strong>{analytics.summary.recorded}</strong><small>当前项目</small></article>
                    <article><span>平均分</span><strong>{analytics.summary.averageScore == null ? "数据不足" : analytics.summary.averageScore.toFixed(1)}</strong><small>只统计已录总分</small></article>
                    <article><span>平均得分率</span><strong>{analytics.summary.averageRate == null ? "数据不足" : `${analytics.summary.averageRate.toFixed(1)}%`}</strong><small>依据总分 {selected.totalScore}</small></article>
                    <article><span>成绩波动度</span><strong>{analytics.summary.volatility == null ? "数据不足" : analytics.summary.volatility.toFixed(1)}</strong><small>至少需要 3 条已录成绩</small></article>
                  </div>
                  <p className={styles.evidenceNote}>统计规则：空白成绩不计入平均分、得分率或波动度；统计不足不以 0 代替。</p>
                  {analytics.questions.length > 0 ? (
                    <div className={styles.questionStats}>
                      <h4>逐题统计</h4>
                      {analytics.questions.map((question) => (
                        <div key={`${question.questionNumber}-${question.knowledgePoints}-${question.errorType}`}>
                          <strong>第 {question.questionNumber} 题</strong>
                          <span>{question.averageScore == null ? "平均得分不足" : `平均 ${question.averageScore.toFixed(1)} 分`}</span>
                          <span>{question.correctRate == null ? "正确率数据不足" : `得分率 ${question.correctRate.toFixed(1)}%`}</span>
                          <small>{question.knowledgePoints || question.errorType || `已记录 ${question.count} 份`}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.dataEmpty}>暂无逐题统计；需要已保存的逐题成绩后才会显示。</div>
                  )}
                </>
              )}
            </section>
          </section>
        )}
      </div>
    </AppShell>
  );
}
