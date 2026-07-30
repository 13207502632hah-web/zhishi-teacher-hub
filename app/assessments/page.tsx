"use client";

import Link from "@/app/components/HardNavigationLink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { EmptyState, MetricCard, Panel, StatusBadge } from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";

type Row = Record<string, any>;
type AssessmentForm = {
  title: string;
  date: string;
  classId: string;
  paperId: string;
  totalScore: string;
  type: string;
  notes: string;
};

const blankAssessment = (classId = ""): AssessmentForm => ({
  title: "政治课堂测验",
  date: new Date().toISOString().slice(0, 10),
  classId,
  paperId: "",
  totalScore: "100",
  type: "课堂测验",
  notes: "",
});

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError ? reason.message : fallback;

const statusTone = (status: string): "success" | "warning" =>
  status === "completed" ? "success" : "warning";

export default function AssessmentsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [classes, setClasses] = useState<Row[]>([]);
  const [papers, setPapers] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<AssessmentForm>(() => blankAssessment());
  const [formBaseline, setFormBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [assessmentLoadError, setAssessmentLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);
  const formDirtyRef = useRef(false);

  const formDirty = Boolean(open && formBaseline && JSON.stringify(form) !== formBaseline);
  const assessmentMetrics = useMemo(() => {
    const completed = rows.filter((item) => item.status === "completed").length;
    const recorded = rows.reduce((sum, item) => sum + Number(item.resultCount || 0), 0);
    const scored = rows
      .map((item) => Number(item.averageScore))
      .filter((value) => Number.isFinite(value));
    const average = scored.length
      ? Math.round(scored.reduce((sum, value) => sum + value, 0) / scored.length * 10) / 10
      : null;
    return { total: rows.length, completed, draft: rows.length - completed, recorded, average };
  }, [rows]);

  const openAssessment = useCallback(() => {
    const next = blankAssessment(classFilter);
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setMessage("");
    setOpen(true);
  }, [classFilter]);

  const dismissAssessment = useCallback(() => {
    if (submittingRef.current) return;
    if (formDirtyRef.current && !window.confirm("当前测验尚未创建，确定放弃这些修改吗？")) return;
    setOpen(false);
    setFormBaseline("");
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setAssessmentLoadError("");
    try {
      const params = new URLSearchParams({ classId: classFilter, status });
      const [assessmentData, classData, paperData] = await Promise.all([
        requestJson<{ assessments?: Row[] }>(`/api/assessments?${params}`, { signal }),
        requestJson<{ classes?: Row[] }>("/api/classes?status=active", { signal }),
        requestJson<{ papers?: Row[] }>("/api/papers?status=all", { signal }),
      ]);
      if (!assessmentData || !classData || !paperData) {
        throw new HttpError(200, "测验中心响应不完整，请重试");
      }
      setRows(assessmentData.assessments || []);
      setClasses(classData.classes || []);
      setPapers(paperData.papers || []);
    } catch (reason) {
      if (!signal?.aborted) {
        setAssessmentLoadError(errorMessage(reason, "暂时无法读取测验中心"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [classFilter, status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedClass = params.get("classId") || "";
    if (requestedClass) {
      setClassFilter(requestedClass);
      setForm((current) => ({ ...current, classId: requestedClass }));
    }
  }, []);

  useEffect(() => {
    submittingRef.current = submitting;
    formDirtyRef.current = formDirty;
  }, [formDirty, submitting]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable[0] || dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissAssessment();
        return;
      }
      if (event.key === "Tab") {
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
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dismissAssessment, open]);

  useEffect(() => {
    if (!open) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!formDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [open]);

  const save = async () => {
    if (submitting) return;
    const totalScore = Number(form.totalScore);
    if (!form.title.trim() || !form.date || !form.classId) {
      setMessage("请完整填写测验名称、日期和班级");
      return;
    }
    if (!Number.isFinite(totalScore) || totalScore <= 0 || totalScore > 1000) {
      setMessage("总分必须在 1 到 1000 之间");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      await requestJson("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setFormBaseline("");
      setOpen(false);
      setMessage("测验已创建，可以录入全班成绩");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(errorMessage(reason, "新建测验失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="测验与成绩"
      subtitle="用真实成绩记录课堂效果，再进入薄弱知识点分析"
      actions={(
        <>
          <Link prefetch={false} className="secondaryButton" href="/api/exports/assessments">
            导出成绩 CSV
          </Link>
          <button className="primaryButton" onClick={openAssessment}>＋ 新建测验</button>
        </>
      )}
    >
      <div className="assessmentPage">
        {message && <div className="assessmentNotice" role="status">{message}</div>}

        <section className="assessmentMetricGrid" aria-label="当前筛选概览">
          <MetricCard label="测验记录" value={assessmentMetrics.total} detail="当前筛选" />
          <MetricCard label="已完成" value={assessmentMetrics.completed} detail="可用于学情分析" />
          <MetricCard label="录入中" value={assessmentMetrics.draft} detail="仍可继续补录" />
          <MetricCard
            label="平均分"
            value={assessmentMetrics.average ?? "—"}
            detail={`累计录入 ${assessmentMetrics.recorded} 人次`}
          />
        </section>

        <Panel
          className="assessmentFilterPanel"
          eyebrow="筛选"
          title="定位班级测验"
          description="按班级与录入状态缩小范围。"
        >
          <div className="assessmentToolbar" role="group" aria-label="筛选测验">
            <label>
              班级
              <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                <option value="">全部班级</option>
                {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label>
              状态
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">全部状态</option>
                <option value="draft">录入中</option>
                <option value="completed">已完成</option>
              </select>
            </label>
          </div>
        </Panel>

        {loading && (
          <div className="assessmentLoading" role="status">
            <span>正在读取测验记录…</span>
          </div>
        )}

        {assessmentLoadError && (
          <div className="assessmentLoadError" role="alert">
            <div>
              <strong>测验记录读取失败</strong>
              <p>{assessmentLoadError}</p>
            </div>
            <button className="secondaryButton" onClick={() => setReloadKey((value) => value + 1)}>
              重新读取测验
            </button>
          </div>
        )}

        {!loading && !assessmentLoadError && (
          <Panel
            className="assessmentListPanel"
            eyebrow="成绩记录"
            title="班级测验"
            description="进入单次测验后，可批量录入成绩和教师备注。"
          >
            {rows.length === 0 ? (
              <EmptyState
                title="还没有测验记录"
                description="创建测验后，可以按班级一次录入成绩并查看真实统计。"
                action={<button className="secondaryButton" onClick={openAssessment}>创建第一次测验</button>}
              />
            ) : (
              <div className="assessmentList">
                {rows.map((row) => (
                  <article className="assessmentCard" key={row.id}>
                    <time dateTime={row.date || undefined}>{row.date || "日期待补"}</time>
                    <div className="assessmentCardBody">
                      <StatusBadge tone={statusTone(row.status)}>
                        {row.status === "completed" ? "已完成" : "录入中"}
                      </StatusBadge>
                      <h3><Link href={`/assessments/${row.id}`}>{row.title}</Link></h3>
                      <p>
                        {row.className || "未关联班级"} · {row.type || "课堂测验"} · 总分 {row.totalScore}
                      </p>
                      {row.paperTitle && <small>关联试卷：{row.paperTitle}</small>}
                    </div>
                    <div className="assessmentNumbers" aria-label={`${row.title}录入统计`}>
                      <span><b>{row.resultCount || 0}</b><small>已录人数</small></span>
                      <span><b>{row.averageScore == null ? "—" : row.averageScore}</b><small>平均分</small></span>
                    </div>
                    <Link className="secondaryButton assessmentOpenButton" href={`/assessments/${row.id}`}>
                      录入 / 查看
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>

      {open && (
        <div className="assessmentModalBackdrop">
          <div
            className="assessmentModal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="assessment-title"
            tabIndex={-1}
          >
            <header className="assessmentModalTitle">
              <div>
                <p>建立真实成绩记录</p>
                <h2 id="assessment-title">新建测验</h2>
              </div>
              <button aria-label="关闭" disabled={submitting} onClick={dismissAssessment}>×</button>
            </header>

            <div className="assessmentForm">
              <label className="wide">
                测验名称
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </label>
              <label>
                日期
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </label>
              <label>
                班级
                <select
                  value={form.classId}
                  onChange={(event) => setForm({ ...form, classId: event.target.value })}
                >
                  <option value="">请选择班级</option>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                类型
                <select
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                >
                  {["课堂测验", "单元测验", "阶段考试", "模拟考试"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                总分
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={form.totalScore}
                  onChange={(event) => setForm({ ...form, totalScore: event.target.value })}
                />
              </label>
              <label className="wide">
                关联试卷（可选）
                <select
                  value={form.paperId}
                  onChange={(event) => setForm({ ...form, paperId: event.target.value })}
                >
                  <option value="">不关联试卷</option>
                  {papers.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </select>
              </label>
              <label className="wide">
                备注
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </label>
            </div>

            <footer className="assessmentModalActions">
              <button disabled={submitting} onClick={dismissAssessment}>取消</button>
              <button className="primaryButton" disabled={submitting} onClick={save}>
                {submitting ? "创建中…" : "创建并录入成绩"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
