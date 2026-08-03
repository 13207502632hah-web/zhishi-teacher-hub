"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/ui/Primitives";
import { useSessionState } from "../components/SessionProvider";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./academic-years.module.css";

const CONFIRMATION_PHRASE = "确认晋升";
const ACADEMIC_YEAR_PATTERN = /^20\d{2}-20\d{2}$/;
const EMPTY_SUMMARY = {
  affectedStudentCount: 0,
  affectedClassCount: 0,
  graduationCount: 0,
  skippedCount: 0,
  conflictCount: 0,
};

type Stage = "select" | "preview" | "impact" | "confirm";
type BusyAction = "preview" | "confirm" | null;

type PromotionItem = {
  id: number;
  studentId: number;
  name: string;
  school?: string | null;
  classNames?: string | null;
  fromGrade: string;
  toGrade: string;
  action: string;
  status: string;
  reason?: string | null;
  currentGrade?: string | null;
  studentStatus?: string | null;
  conflict?: boolean;
  conflictReason?: string | null;
};

type SkippedItem = {
  studentId: number;
  name: string;
  grade?: string | null;
  reason?: string | null;
};

type PromotionSummary = {
  affectedStudentCount: number;
  affectedClassCount: number;
  graduationCount: number;
  skippedCount: number;
  conflictCount: number;
};

type PromotionPreview = {
  run: { id: number; status: string };
  items?: PromotionItem[];
  skipped?: SkippedItem[];
  summary?: PromotionSummary;
  previewToken: string;
  previewExpiresAt: string;
  notice?: string;
};

type PromotionConfirmation = {
  ok: true;
  confirmed: number;
  excluded: number;
  runId: number;
};

const targetYear = () => {
  const now = new Date();
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}-${start + 1}`;
};

const academicYearOptions = () => {
  const start = Number(targetYear().slice(0, 4));
  return Array.from({ length: 5 }, (_, index) => {
    const year = start - 2 + index;
    return `${year}-${year + 1}`;
  });
};

const failureMessage = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

const requiresPreview = (reason: unknown) =>
  reason instanceof HttpError &&
  reason.status === 409 &&
  Boolean(
    reason.payload &&
      typeof reason.payload === "object" &&
      (reason.payload as { requiresPreview?: boolean }).requiresPreview,
  );

export default function AcademicYearsPage() {
  const { session } = useSessionState();
  const canExecute = session.role === "teacher";
  const [year, setYear] = useState(targetYear);
  const [stage, setStage] = useState<Stage>("select");
  const [previewData, setPreviewData] = useState<PromotionPreview | null>(null);
  const [selectedExcluded, setSelectedExcluded] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoadError, setPreviewLoadError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [confirmRequiresPreview, setConfirmRequiresPreview] = useState(false);
  const [previewExpired, setPreviewExpired] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyActionRef = useRef<BusyAction>(null);
  const queryLoadedRef = useRef(false);

  const options = useMemo(() => academicYearOptions(), []);
  const items = previewData?.items || [];
  const skipped = previewData?.skipped || [];
  const summary = previewData?.summary || EMPTY_SUMMARY;
  const hasConflicts = Number(summary.conflictCount) > 0;
  const canConfirm = Boolean(
    canExecute &&
      previewData?.run.status === "preview" &&
      previewData.previewToken &&
      !previewExpired &&
      !hasConflicts &&
      items.length,
  );

  const beginAction = useCallback((action: Exclude<BusyAction, null>) => {
    if (busyActionRef.current) return false;
    busyActionRef.current = action;
    setBusyAction(action);
    return true;
  }, []);

  const endAction = (action: Exclude<BusyAction, null>) => {
    if (busyActionRef.current === action) {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  };

  const loadPreview = useCallback(
    async (selectedYear: string, signal?: AbortSignal) => {
      if (!beginAction("preview")) return;
      setLoading(true);
      setStage("preview");
      setPreviewLoadError("");
      setConfirmError("");
      setSuccessMessage("");
      setPreviewData(null);
      setSelectedExcluded([]);
      try {
        const data = await requestJson<PromotionPreview>(
          `/api/academic-years/${encodeURIComponent(selectedYear)}/promotion`,
          { signal, timeoutMs: 15_000 },
        );
        if (!data) throw new HttpError(200, "晋升预览响应为空，请重试");
        setPreviewData(data);
        setPreviewExpired(false);
        setSelectedExcluded(
          (data.items || [])
            .filter((item) => item.status === "excluded")
            .map((item) => Number(item.studentId)),
        );
        setStage("impact");
      } catch (reason) {
        if (!signal?.aborted) {
          setPreviewData(null);
          setPreviewLoadError(failureMessage(reason, "暂时无法生成晋升预览"));
          setStage("preview");
        }
      } finally {
        if (!signal?.aborted) {
          endAction("preview");
          setLoading(false);
        }
      }
    },
    [beginAction],
  );

  useEffect(() => {
    if (queryLoadedRef.current) return;
    queryLoadedRef.current = true;
    const controller = new AbortController();
    const requested = new URLSearchParams(window.location.search).get("year");
    if (requested && ACADEMIC_YEAR_PATTERN.test(requested)) {
      setYear(requested);
      void loadPreview(requested, controller.signal);
    }
    return () => controller.abort();
  }, [loadPreview]);

  useEffect(() => {
    if (!previewData?.previewExpiresAt || previewData.run.status !== "preview") {
      setPreviewExpired(false);
      return;
    }
    const remaining = Date.parse(previewData.previewExpiresAt) - Date.now();
    if (remaining <= 0) {
      setPreviewExpired(true);
      return;
    }
    const timer = setTimeout(() => setPreviewExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [previewData?.previewExpiresAt, previewData?.run.status]);

  const changeYear = (nextYear: string) => {
    setYear(nextYear);
    setStage("select");
    setPreviewData(null);
    setPreviewExpired(false);
    setSelectedExcluded([]);
    setPreviewLoadError("");
    setConfirmError("");
    setConfirmRequiresPreview(false);
    setSuccessMessage("");
    setConfirmationOpen(false);
    setConfirmPhrase("");
  };

  const openConfirmation = () => {
    if (busyAction || !canExecute || !previewData) return;
    const expiredNow = previewExpired || (previewData.previewExpiresAt && Date.parse(previewData.previewExpiresAt) <= Date.now());
    if (expiredNow || hasConflicts) {
      setPreviewLoadError("预览已过期或存在数据冲突，请重新生成预览");
      setPreviewExpired(true);
      setPreviewData(null);
      setStage("preview");
      return;
    }
    setConfirmError("");
    setConfirmRequiresPreview(false);
    setConfirmPhrase("");
    setConfirmationOpen(true);
    setStage("confirm");
  };

  const dismissConfirmation = useCallback(() => {
    if (busyActionRef.current === "confirm") return;
    setConfirmationOpen(false);
    setConfirmPhrase("");
    setConfirmError("");
    setConfirmRequiresPreview(false);
    setStage("impact");
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!confirmationOpen || !dialog) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable[0] || dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissConfirmation();
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
      previousFocusRef.current = null;
    };
  }, [confirmationOpen, dismissConfirmation]);

  const confirmPromotion = async () => {
    if (busyAction) return;
    if (
      !canConfirm ||
      !previewData ||
      confirmPhrase.trim() !== CONFIRMATION_PHRASE
    ) {
      return;
    }
    if (!beginAction("confirm")) return;
    setConfirmError("");
    setPreviewLoadError("");
    setSuccessMessage("");
    try {
      const data = await requestJson<PromotionConfirmation>(
        `/api/academic-years/${encodeURIComponent(year)}/promotion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: "确认晋升",
            previewToken: previewData.previewToken,
            excludedStudentIds: selectedExcluded,
          }),
          timeoutMs: 15_000,
        },
      );
      if (!data) throw new HttpError(200, "晋升确认响应为空，请重新生成预览");
      setConfirmationOpen(false);
      setConfirmPhrase("");
      setSuccessMessage(
        `学年晋升已完成：${data.confirmed} 名学生已更新，${data.excluded} 名学生已跳过。此操作不可轻易撤销。`,
      );
      setPreviewData((current) =>
        current
          ? {
              ...current,
              run: { ...current.run, status: "confirmed" },
              items: (current.items || []).map((item) => ({
                ...item,
                status: selectedExcluded.includes(Number(item.studentId))
                  ? "excluded"
                  : "confirmed",
              })),
            }
          : current,
      );
      setStage("impact");
    } catch (reason) {
      const stale = requiresPreview(reason);
      const message = stale
        ? "预览已过期或数据已变化，请重新生成预览"
        : failureMessage(reason, "晋升确认失败，未显示成功；请重试");
      setSuccessMessage("");
      setConfirmError(message);
      setConfirmRequiresPreview(stale);
      if (stale) {
        setPreviewData(null);
        setConfirmationOpen(false);
        setStage("preview");
        setPreviewLoadError(message);
      }
    } finally {
      endAction("confirm");
      setBusyAction(null);
    }
  };

  const stepIndex = { select: 0, preview: 1, impact: 2, confirm: 3 }[stage];
  const stageItems = [
    ["select", "选择学年"],
    ["preview", "生成预览"],
    ["impact", "核对影响"],
    ["confirm", "最终确认"],
  ] as const;

  return (
    <AppShell
      title="学年晋升"
      subtitle="先生成只读预览，再核对每名学生、班级、毕业与跳过项，最后由教师明确确认"
    >
      <div className={styles.page}>
        <section className={styles.intro} aria-labelledby="promotion-page-title">
          <p className={styles.eyebrow}>安全流程 · 不自动修改学生或班级数据</p>
          <h2 id="promotion-page-title">把新学年的影响看清楚，再决定是否执行</h2>
          <p>
            生成预览只读取当前数据并整理晋升建议。只有教师输入“确认晋升”并提交最终确认后，学生年级才会更新。
          </p>
        </section>

        <ol className={styles.stepper} aria-label="学年晋升四阶段流程">
          {stageItems.map(([key, label], index) => (
            <li
              key={key}
              className={index <= stepIndex ? styles.stepActive : styles.step}
              data-stage={key}
              aria-current={stage === key ? "step" : undefined}
            >
              <span>{index + 1}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>

        {!canExecute && session.authenticated && (
          <div className={styles.permissionNotice} role="status">
            <strong>当前账号只能查看，不能执行学年晋升。</strong>
            <p>只有教师可以执行学年晋升；助教、学生和家长不会看到可执行的确认入口。</p>
          </div>
        )}

        <section className={styles.selectionPanel} aria-labelledby="academic-year-selection-title">
          <div>
            <p className={styles.sectionKicker}>1 · 选择学年</p>
            <h2 id="academic-year-selection-title">选择要核对的目标学年</h2>
            <p className={styles.helperText}>选择学年不会改变任何学生或班级数据。</p>
          </div>
          <div className={styles.selectionActions}>
            <label htmlFor="academic-year-select">
              目标学年
              <select
                id="academic-year-select"
                value={options.includes(year) ? year : ""}
                onChange={(event) => changeYear(event.target.value)}
                disabled={Boolean(busyAction)}
              >
                {!options.includes(year) && <option value="">请选择学年</option>}
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <button
              className={styles.primaryAction}
              type="button"
              disabled={!canExecute || Boolean(busyAction) || !ACADEMIC_YEAR_PATTERN.test(year)}
              onClick={() => void loadPreview(year)}
            >
              {busyAction === "preview" ? "正在生成预览…" : "生成预览"}
            </button>
          </div>
        </section>

        {loading && (
          <div className={styles.loading} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            正在读取学生、班级与晋升影响…
          </div>
        )}

        {previewLoadError && (
          <div className={styles.error} role="alert">
            <div>
              <strong>预览未完成</strong>
              <p>{previewLoadError}</p>
            </div>
            <button
              className={styles.secondaryAction}
              type="button"
              disabled={!canExecute || Boolean(busyAction)}
              onClick={() => void loadPreview(year)}
            >
              重新生成预览
            </button>
          </div>
        )}

        {successMessage && (
          <div className={styles.success} role="status" aria-live="polite">{successMessage}</div>
        )}

        {!previewData && !loading && !previewLoadError && (
          <EmptyState
            className={styles.emptyState}
            title="先选择学年并生成预览"
            description="第一次操作只会读取并展示预览，不会执行晋升。"
            action={(
              <button
                className={styles.secondaryAction}
                type="button"
                disabled={!canExecute || Boolean(busyAction)}
                onClick={() => void loadPreview(year)}
              >
                生成第一次预览
              </button>
            )}
          />
        )}

        {previewData && (
          <section className={styles.previewPanel} aria-labelledby="promotion-preview-title">
            <header className={styles.previewHeader}>
              <div>
                <p className={styles.sectionKicker}>2 · 生成预览</p>
                <h2 id="promotion-preview-title">{year} 学年晋升影响预览</h2>
                <p className={styles.helperText}>{previewData.notice || "预览只读，尚未修改学生或班级数据。"}</p>
              </div>
              <span className={styles.previewStatus}>
                {previewData.run.status === "confirmed" ? "已确认" : "待教师确认"}
              </span>
            </header>

            <div className={styles.metrics} aria-label="晋升影响摘要">
              <article className={styles.metric}><span>受影响学生</span><strong>{Number(summary.affectedStudentCount)}</strong><small>将更新年级或毕业状态</small></article>
              <article className={styles.metric}><span>涉及班级</span><strong>{Number(summary.affectedClassCount)}</strong><small>按当前有效报名关系统计</small></article>
              <article className={styles.metric}><span>毕业状态</span><strong>{Number(summary.graduationCount)}</strong><small>建议标记为毕业</small></article>
              <article className={styles.metric}><span>跳过项</span><strong>{Number(summary.skippedCount)}</strong><small>没有可用晋升规则</small></article>
              <article className={hasConflicts ? styles.metricDanger : styles.metric}><span>冲突项</span><strong>{Number(summary.conflictCount)}</strong><small>{hasConflicts ? "必须重新生成预览" : "当前快照一致"}</small></article>
            </div>

            <section className={styles.impactSection} aria-labelledby="promotion-impact-title">
              <div className={styles.sectionHeader}>
                <div>
                  <p className={styles.sectionKicker}>3 · 核对影响</p>
                  <h3 id="promotion-impact-title">逐名核对学生、班级和毕业状态</h3>
                </div>
                <p className={styles.expiryText}>
                  预览有效至 {previewData.previewExpiresAt ? new Date(previewData.previewExpiresAt).toLocaleString("zh-CN") : "重新生成前"}
                </p>
              </div>

              {(previewExpired || hasConflicts) && (
                <div className={styles.warning} role="alert">
                  {previewExpired
                    ? "预览已过期，请重新生成预览后再确认。"
                    : `发现 ${Number(summary.conflictCount)} 项冲突：学生资料或报名关系已变化。确认入口已锁定，请重新生成预览。`}
                  <button
                    className={styles.secondaryAction}
                    type="button"
                    disabled={!canExecute || Boolean(busyAction)}
                    onClick={() => void loadPreview(year)}
                  >
                    重新生成预览
                  </button>
                </div>
              )}

              {items.length === 0 && skipped.length === 0 ? (
                <EmptyState
                  className={styles.emptyState}
                  title="本学年没有可生成晋升的学生"
                  description="当前没有 active 且具有可识别年级的学生记录；系统没有虚构任何影响。"
                />
              ) : items.length > 0 ? (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <caption>晋升候选清单。勾选跳过项只会在最终确认时生效。</caption>
                    <thead>
                      <tr><th scope="col">跳过</th><th scope="col">学生</th><th scope="col">班级</th><th scope="col">当前年级</th><th scope="col">建议结果</th><th scope="col">毕业状态</th><th scope="col">核对状态</th></tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const excluded = selectedExcluded.includes(Number(item.studentId));
                        const conflict = Boolean(item.conflict);
                        const disabled = !canExecute || Boolean(busyAction) || previewData.run.status !== "preview" || conflict;
                        return (
                          <tr key={item.id} className={conflict ? styles.conflictRow : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                checked={excluded}
                                disabled={disabled}
                                aria-label={`跳过${item.name}`}
                                onChange={() => setSelectedExcluded((current) => excluded ? current.filter((id) => id !== Number(item.studentId)) : [...current, Number(item.studentId)])}
                              />
                            </td>
                            <td><strong>{item.name}</strong><small>{item.school || "学校未填写"}</small></td>
                            <td>{item.classNames || "未分班"}</td>
                            <td>{item.currentGrade || item.fromGrade}</td>
                            <td>{item.toGrade || "—"}</td>
                            <td>{item.action === "graduate" || item.toGrade === "毕业" ? "毕业" : "升入下一年级"}</td>
                            <td>
                              {conflict ? <span className={styles.statusDanger}>{item.conflictReason || "数据已变化"}</span> : excluded ? <span className={styles.statusMuted}>本次跳过</span> : item.status === "confirmed" ? <span className={styles.statusSuccess}>已更新</span> : <span className={styles.statusPending}>待确认</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {skipped.length > 0 && (
                <details className={styles.skippedDetails}>
                  <summary>查看 {skipped.length} 个跳过项</summary>
                  <ul>
                    {skipped.map((item) => <li key={item.studentId}><strong>{item.name}</strong><span>{item.grade || "年级未填写"} · {item.reason || "没有可用晋升规则"}</span></li>)}
                  </ul>
                </details>
              )}
            </section>

            <footer className={styles.previewFooter}>
              <p>勾选“跳过”只会保留该学生原年级；未勾选的学生才会进入最终确认清单。</p>
              {previewData.run.status === "confirmed" ? (
                <span className={styles.statusSuccess}>该学年已完成确认，不能重复提交。</span>
              ) : (
                <button
                  className={styles.dangerAction}
                  type="button"
                  disabled={!canConfirm || Boolean(busyAction)}
                  onClick={openConfirmation}
                >
                  进入最终确认
                </button>
              )}
            </footer>
          </section>
        )}
      </div>

      {confirmationOpen && previewData && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) dismissConfirmation(); }}
        >
          <div
            ref={dialogRef}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="promotion-confirmation-title"
            tabIndex={-1}
          >
            <p className={styles.sectionKicker}>4 · 最终确认</p>
            <h2 id="promotion-confirmation-title">确认执行 {year} 学年晋升？</h2>
            <div className={styles.dangerNotice}>
              <strong>这是不可轻易撤销的教师级操作。</strong>
              <p>提交后将更新 {Number(summary.affectedStudentCount) - selectedExcluded.length} 名学生的年级，其中 {Number(summary.graduationCount)} 名可能进入“毕业”状态；跳过的 {selectedExcluded.length} 名学生保持原年级。请先确认学生和班级名单无误。</p>
            </div>
            {confirmError && <div className={styles.error} role="alert"><p>{confirmError}</p>{confirmRequiresPreview && <button className={styles.secondaryAction} type="button" onClick={() => void loadPreview(year)}>重新生成预览</button>}</div>}
            <label className={styles.confirmField} htmlFor="promotion-confirm-phrase">
              输入“{CONFIRMATION_PHRASE}”以解锁最终提交
              <input id="promotion-confirm-phrase" value={confirmPhrase} onChange={(event) => setConfirmPhrase(event.target.value)} autoComplete="off" disabled={busyAction === "confirm"} />
            </label>
            <div className={styles.dialogActions}>
              <button className={styles.secondaryAction} type="button" disabled={busyAction === "confirm"} onClick={dismissConfirmation}>返回核对</button>
              <button
                className={styles.dangerAction}
                type="button"
                disabled={!canConfirm || confirmPhrase.trim() !== CONFIRMATION_PHRASE || Boolean(busyAction)}
                onClick={() => void confirmPromotion()}
              >
                {busyAction === "confirm" ? "正在提交确认…" : "我已阅读影响，确认执行学年晋升"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
