"use client";

import Link from "@/app/components/HardNavigationLink";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import {
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";

type PreviewAction = "create" | "update" | "skip" | "blocked";
type Preview = {
  action: PreviewAction;
  classToCreate: string | null;
  existingLessonId: number | null;
  issues: string[];
  studentsToCreate: string[];
};
type ScheduleValue = {
  date: string;
  startTime: string;
  endTime: string;
  studentNames: string[];
  className: string;
  courseName: string;
  location: string;
  fee: number;
  baseFee: number;
  perStudentFee: number;
};
type PreviewRow = {
  rowNumber: number;
  sourceCell: string;
  issues: string[];
  value: ScheduleValue;
  preview: Preview;
};
type PreviewReport = {
  total: number;
  invalid: number;
  create: number;
  update: number;
  skip: number;
  blocked: number;
  studentsToCreate: number;
  classesToCreate: number;
};
type UnknownColumn = {
  name: string;
  suggestions: string[];
};
type ImportResult = {
  id: number;
  format: "calendar_matrix" | "tabular";
  rows: PreviewRow[];
  report: PreviewReport;
  unknownColumns?: UnknownColumn[];
};
type ConfirmReport = {
  created?: number;
  updated?: number;
  skipped?: number;
  blocked?: number;
  studentsCreated?: number;
  remaining?: number;
};
type ConfirmRow = {
  id: number;
  rowNumber: number;
  action: string;
  issue: string | null;
  lessonId: number | null;
};
type ConfirmResult = {
  repeated?: boolean;
  status?: string;
  report?: ConfirmReport;
  rows?: ConfirmRow[];
};
type HistoryItem = {
  id: number;
  sourceName: string;
  fingerprint: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  report?: PreviewReport & ConfirmReport;
};
type HistoryRow = {
  id: number;
  rowNumber: number;
  action: string;
  issue: string | null;
  lessonId: number | null;
  normalizedData: string | null;
};
type HistoryDetail = {
  import: HistoryItem;
  rows: HistoryRow[];
};
type BusyAction = "" | "upload" | "confirm";
type UploadStage = {
  name: "reading" | "parsing" | "checking";
  label: string;
  total: number;
};

const actionMeta: Record<
  PreviewAction,
  { label: string; tone: "success" | "info" | "neutral" | "danger" }
> = {
  create: { label: "将新建", tone: "success" },
  update: { label: "将调整", tone: "info" },
  skip: { label: "将跳过", tone: "neutral" },
  blocked: { label: "已阻止", tone: "danger" },
};

const historyStatusMeta: Record<
  string,
  { label: string; tone: "success" | "info" | "neutral" | "danger" | "warning" }
> = {
  preview: { label: "待确认", tone: "info" },
  confirming: { label: "正在导入", tone: "info" },
  confirmed: { label: "已完成", tone: "success" },
  partial: { label: "部分完成", tone: "warning" },
  failed: { label: "失败", tone: "danger" },
};

const historyRowMeta: Record<
  string,
  { label: string; tone: "success" | "info" | "neutral" | "danger" }
> = {
  pending: { label: "待处理", tone: "neutral" },
  created: { label: "已新建", tone: "success" },
  updated: { label: "已调整", tone: "info" },
  skipped: { label: "已跳过", tone: "neutral" },
  blocked: { label: "已阻止", tone: "danger" },
};

const historyPreviewAction = (action: string) =>
  action === "created" ? "create" : action === "updated" ? "update" : action === "skipped" ? "skip" : action;

const formatTime = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const parseHistoryValue = (raw: string | null): ScheduleValue | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ScheduleValue;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError ? reason.message : fallback;

export default function ScheduleImportsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [message, setMessage] = useState("");
  const [duplicateAvailable, setDuplicateAvailable] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyDetail, setHistoryDetail] = useState<HistoryDetail | null>(null);
  const [historyBusyId, setHistoryBusyId] = useState<number | null>(null);
  const [confirmedRows, setConfirmedRows] = useState<ConfirmRow[]>([]);
  const [unknownColumns, setUnknownColumns] = useState<UnknownColumn[]>([]);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [remainingCount, setRemainingCount] = useState(0);
  const busy = Boolean(busyAction);
  const hasUnsavedPreview = Boolean(result && !confirmed);
  const confirmableCount = (result?.report.create || 0) + (result?.report.update || 0);
  const confirmButtonLabel = confirmed
    ? "已确认导入"
    : busyAction === "confirm"
      ? "正在确认写入…"
      : remainingCount > 0
        ? `重试剩余 ${remainingCount} 行`
        : `确认导入 ${confirmableCount} 节有效课程`;

  useEffect(() => {
    const protectPreview = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedPreview) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPreview);
    return () => window.removeEventListener("beforeunload", protectPreview);
  }, [hasUnsavedPreview]);

  useEffect(() => {
    let cancelled = false;
    requestJson<{ imports: HistoryItem[] }>("/api/schedule-imports")
      .then((data) => {
        if (!cancelled) setHistory(data?.imports || []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = async (allowDuplicate = false) => {
    if (!file || busy) return;
    setBusyAction("upload");
    setMessage("正在识别课表并检查现有课时…");
    setDuplicateAvailable(false);
    setConfirmed(false);
    setConfirmedRows([]);
    setUnknownColumns([]);
    setUploadStage(null);
    setRemainingCount(0);
    try {
      let totalRows = 0;
      if (file.name.toLowerCase().endsWith(".csv")) {
        setUploadStage({ name: "reading", label: "正在读取 CSV 行数…", total: 0 });
        const text = await file.text();
        totalRows = text.split(/\r?\n/).filter((line) => line.trim()).length;
        setUploadStage({ name: "parsing", label: `已读取 ${totalRows} 行，正在上传解析…`, total: totalRows });
      } else {
        setUploadStage({ name: "parsing", label: "正在解析工作表并检查文件结构…", total: 0 });
      }
      setUploadStage({ name: "checking", label: "正在逐行核对现有课时与冲突…", total: totalRows });
      const form = new FormData();
      form.set("file", file);
      if (allowDuplicate) form.set("allowDuplicate", "1");
      const data = await requestJson<ImportResult>("/api/schedule-imports", {
        method: "POST",
        body: form,
        timeoutMs: 30_000,
      });
      if (!data?.id || !data.report || !Array.isArray(data.rows)) {
        throw new HttpError(200, "课表预览响应不完整，请重新上传");
      }
      setUploadStage(null);
      setResult(data);
      setUnknownColumns(data.unknownColumns || []);
      setRemainingCount(0);
      setMessage(
        `已识别 ${data.report.total} 节：将新建 ${data.report.create} 节、调整 ${data.report.update} 节、跳过 ${data.report.skip} 节、阻止 ${data.report.blocked} 节${data.unknownColumns?.length ? `。另有 ${data.unknownColumns.length} 列未识别` : ""}。`,
      );
      void refreshHistory();
    } catch (reason) {
      setResult(null);
      setUploadStage(null);
      if (reason instanceof HttpError && reason.status === 409) {
        setDuplicateAvailable(true);
        setMessage(`${reason.message}。如课表确有修改，可重新比较，不会立即写入课时。`);
      } else {
        if (reason instanceof HttpError) {
          const payload = reason.payload as { unknownColumns?: UnknownColumn[] } | null;
          setUnknownColumns(Array.isArray(payload?.unknownColumns) ? payload.unknownColumns : []);
        }
        setMessage(errorMessage(reason, "课表识别失败，请检查文件后重试"));
      }
    } finally {
      setBusyAction("");
      setUploadStage(null);
    }
  };

  const confirmImport = async () => {
    if (!result || busy || confirmed || (remainingCount === 0 && confirmableCount === 0)) return;
    const decision = [
      `新建 ${result.report.create} 节课`,
      `调整 ${result.report.update} 节课`,
      `新建 ${result.report.studentsToCreate} 名学生`,
      `新建 ${result.report.classesToCreate} 个班级`,
    ].join("、");
    if (!window.confirm(`确认执行本次课表导入？预计${decision}。冲突与无效行不会写入。`)) {
      return;
    }

    setBusyAction("confirm");
    setMessage("正在重新检查冲突并写入有效课时…");
    try {
      const data = await requestJson<ConfirmResult>(`/api/schedule-imports/${result.id}/confirm`, { method: "POST" });
      const report = data?.report;
      if (!report) throw new HttpError(200, "导入响应不完整，请到课时列表核对");
      setConfirmedRows(data?.rows || []);
      const status = data?.status || "confirmed";
      if (status === "confirmed") {
        setConfirmed(true);
        setRemainingCount(0);
        setMessage(
          `${data?.repeated ? "该任务此前已完成。" : "导入完成："}新建 ${report.created || 0} 节、调整 ${report.updated || 0} 节、跳过 ${report.skipped || 0} 节、阻止 ${report.blocked || 0} 节。`,
        );
      } else {
        setConfirmed(false);
        setRemainingCount(report.remaining || 0);
        setMessage(
          `${status === "failed" ? "导入失败：" : "导入部分完成："}新建 ${report.created || 0} 节、调整 ${report.updated || 0} 节、跳过 ${report.skipped || 0} 节、阻止 ${report.blocked || 0} 节。还有 ${report.remaining || 0} 行未写入，可重试剩余行。`,
        );
      }
      void refreshHistory();
    } catch (reason) {
      setMessage(errorMessage(reason, "确认写入失败，尚未完成的行可重试"));
    } finally {
      setBusyAction("");
    }
  };

  const refreshHistory = async () => {
    try {
      const data = await requestJson<{ imports: HistoryItem[] }>("/api/schedule-imports");
      setHistory(data?.imports || []);
    } catch {
      // 历史列表刷新失败不阻断当前导入流程。
    }
  };

  const openHistory = async (id: number) => {
    setHistoryBusyId(id);
    try {
      const data = await requestJson<HistoryDetail>(`/api/schedule-imports/${id}`);
      if (!data?.import || !Array.isArray(data.rows)) {
        throw new HttpError(200, "导入报告响应不完整，请稍后重试");
      }
      setHistoryDetail(data);
    } catch (reason) {
      setMessage(errorMessage(reason, "无法打开导入报告，请稍后重试"));
    } finally {
      setHistoryBusyId(null);
    }
  };

  const retryHistoryImport = async (id: number) => {
    if (historyBusyId !== null) return;
    setHistoryBusyId(id);
    try {
      const data = await requestJson<ConfirmResult>(`/api/schedule-imports/${id}/confirm`, { method: "POST" });
      const report = data?.report;
      if (!report) throw new HttpError(200, "导入响应不完整，请稍后重试");
      const status = data?.status || "confirmed";
      setMessage(
        `${status === "confirmed" ? "重试完成：" : "仍需处理："}新建 ${report.created || 0} 节、调整 ${report.updated || 0} 节、跳过 ${report.skipped || 0} 节、阻止 ${report.blocked || 0} 节，剩余 ${report.remaining || 0} 行。`,
      );
      setHistoryBusyId(null);
      await openHistory(id);
      void refreshHistory();
    } catch (reason) {
      setMessage(errorMessage(reason, "重试剩余行失败，请稍后再试"));
      setHistoryBusyId(null);
    }
  };

  const selectFile = (nextFile?: File) => {
    setFile(nextFile || null);
    setResult(null);
    setConfirmed(false);
    setDuplicateAvailable(false);
    setConfirmedRows([]);
    setUnknownColumns([]);
    setUploadStage(null);
    setRemainingCount(0);
    setMessage(nextFile ? `已选择 ${nextFile.name}，尚未上传。` : "");
  };

  return (
    <AppShell
      title="课表导入"
      subtitle="先识别、再核对、后写入；课程冲突和同名学生会在确认前拦截"
      actions={<Link className="secondaryButton" href="/lessons">返回课时</Link>}
    >
      <div className="scheduleImportPage">
        <ol className="scheduleImportSteps" aria-label="课表导入步骤">
          <li data-state={result ? "complete" : "current"}>
            <span>1</span>
            <div><b>选择课表</b><small>Excel 或 CSV</small></div>
          </li>
          <li data-state={result && !confirmed ? "current" : confirmed ? "complete" : "upcoming"}>
            <span>2</span>
            <div><b>核对变化</b><small>冲突不写入</small></div>
          </li>
          <li data-state={confirmed ? "complete" : "upcoming"}>
            <span>3</span>
            <div><b>教师确认</b><small>创建课时草稿</small></div>
          </li>
        </ol>

        {message && (
          <div
            className={`scheduleImportNotice${duplicateAvailable ? " isWarning" : ""}`}
            role={duplicateAvailable ? "alert" : "status"}
          >
            <span>{message}</span>
            {duplicateAvailable && (
              <button
                className="secondaryButton"
                disabled={busy}
                onClick={() => void upload(true)}
              >
                重新比较这份课表
              </button>
            )}
          </div>
        )}

        {unknownColumns.length > 0 && (
          <div className="scheduleImportUnknownColumns" role="alert">
            <b>未识别列（{unknownColumns.length}）</b>
            <ul>
              {unknownColumns.map((column) => (
                <li key={column.name}>
                  <span>{column.name}</span>
                  {column.suggestions.length > 0 ? (
                    <small>可改为：{column.suggestions.join("、")}</small>
                  ) : (
                    <small>该列不会参与导入，可删除或改为系统可识别的列名</small>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {uploadStage && (
          <div className="scheduleImportProgress" role="status" aria-live="polite">
            <div className="scheduleImportProgressTrack">
              <span data-stage={uploadStage.name} />
            </div>
            <p>
              {uploadStage.label}
              {uploadStage.total ? ` · 共 ${uploadStage.total} 行` : ""}
            </p>
          </div>
        )}

        <Panel
          className="scheduleImportUpload"
          eyebrow="第 1 步"
          title="选择本地课表"
          description="支持逐行明细表，以及日期横排、时间竖排的周课表。文件只在识别后保存到受控资料区。"
        >
          <div className="scheduleImportUploadBody">
            <label className={`scheduleImportFile${busy ? " isDisabled" : ""}`}>
              <span>{file ? "更换课表文件" : "选择课表文件"}</span>
              <small>{file?.name || "支持 .xlsx、.csv，最大 10MB"}</small>
              <input
                type="file"
                accept=".xlsx,.csv"
                disabled={busy}
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </label>
            <div className="scheduleImportPrivacy">
              <b>写入边界</b>
              <p>识别与预览不会创建学生、班级或课时。旧版 .xls 请先在 WPS 中另存为 .xlsx。</p>
            </div>
            <button
              className="primaryButton"
              disabled={!file || busy}
              onClick={() => void upload(false)}
            >
              {busyAction === "upload" ? "正在识别与检查…" : "识别并生成预览"}
            </button>
          </div>
        </Panel>

        <Panel
          className="scheduleImportHistory"
          eyebrow="导入记录"
          title="最近导入"
          description="识别或确认后会保存批次，刷新页面也能回到历史报告核对逐行结果。"
        >
          {history.length === 0 ? (
            <p className="scheduleImportHistoryEmpty">暂无导入记录。完成第一次识别后，这里会保留每个批次的最终结果。</p>
          ) : (
            <div className="scheduleImportHistoryList">
              {history.slice(0, 8).map((item) => {
                const statusMeta = historyStatusMeta[item.status] || historyStatusMeta.preview;
                const report = item.report;
                return (
                  <article className="scheduleImportHistoryItem" key={item.id}>
                    <div className="scheduleImportHistoryMain">
                      <h3>{item.sourceName}</h3>
                      <p>#{item.id} · {formatTime(item.createdAt)} · 共 {report?.total ?? 0} 节</p>
                    </div>
                    <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
                    <p className="scheduleImportHistoryCounts">
                      新建 {report?.create ?? report?.created ?? 0} · 调整 {report?.update ?? report?.updated ?? 0} · 跳过 {report?.skip ?? report?.skipped ?? 0} · 阻止 {report?.blocked ?? 0}
                    </p>
                    <button
                      className="secondaryButton"
                      disabled={historyBusyId !== null}
                      onClick={() => void openHistory(item.id)}
                    >
                      {historyBusyId === item.id ? "正在打开…" : "查看报告"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </Panel>

        {historyDetail && (
          <Panel
            className="scheduleImportHistoryDetail"
            eyebrow="导入报告"
            title={`${historyDetail.import.sourceName} · #${historyDetail.import.id}`}
            description={`${formatTime(historyDetail.import.createdAt)} · ${historyDetail.rows.length} 行`}
            actions={(
              <div className="scheduleImportHistoryActions">
                {["partial", "failed", "confirming"].includes(historyDetail.import.status) && (
                  <button
                    className="secondaryButton"
                    disabled={historyBusyId !== null}
                    onClick={() => void retryHistoryImport(historyDetail.import.id)}
                  >
                    {historyBusyId === historyDetail.import.id
                      ? "正在重试…"
                      : `重试剩余 ${historyDetail.rows.filter((row) => ["pending", "blocked"].includes(row.action)).length} 行`}
                  </button>
                )}
                <button
                  className="secondaryButton"
                  disabled={historyBusyId !== null}
                  onClick={() => setHistoryDetail(null)}
                >
                  关闭报告
                </button>
              </div>
            )}
          >
            <div className="scheduleImportHistoryDetailMeta">
              <StatusBadge
                tone={(historyStatusMeta[historyDetail.import.status] || historyStatusMeta.preview).tone}
              >
                {(historyStatusMeta[historyDetail.import.status] || historyStatusMeta.preview).label}
              </StatusBadge>
              <span>
                新建 {historyDetail.import.report?.create ?? historyDetail.import.report?.created ?? 0} · 调整 {historyDetail.import.report?.update ?? historyDetail.import.report?.updated ?? 0} · 跳过 {historyDetail.import.report?.skip ?? historyDetail.import.report?.skipped ?? 0} · 阻止 {historyDetail.import.report?.blocked ?? 0}
              </span>
            </div>
            <div className="scheduleImportRows">
              {historyDetail.rows.map((row) => {
                const meta = historyRowMeta[row.action] || historyRowMeta.pending;
                const value = parseHistoryValue(row.normalizedData);
                return (
                  <article
                    data-action={historyPreviewAction(row.action)}
                    key={`history-${row.id}`}
                  >
                    <header>
                      <span>第 {row.rowNumber} 行</span>
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    </header>
                    {value && (
                      <div className="scheduleImportRowMain">
                        <time>
                          <b>{value.date || "日期待补"}</b>
                          <span>{value.startTime || "?"}–{value.endTime || "?"}</span>
                        </time>
                        <div>
                          <h3>{value.courseName || "课程待补"}</h3>
                          <p>{value.className || value.studentNames.join("、") || "学生或班级待补"}</p>
                        </div>
                        <div>
                          <b>{value.location || "地点待补"}</b>
                          <p>
                            {value.fee
                              ? `费用 ${value.fee} 元`
                              : `基础 ${value.baseFee || 0} 元＋每生 ${value.perStudentFee || 0} 元`}
                          </p>
                        </div>
                      </div>
                    )}
                    {row.lessonId && (
                      <p className="scheduleImportLinkedLesson">
                        已关联课时 · <Link href={`/lessons/${row.lessonId}`}>查看课时</Link>
                      </p>
                    )}
                    {row.issue && <p className="scheduleImportIssues">{row.issue}</p>}
                  </article>
                );
              })}
            </div>
          </Panel>
        )}

        {result ? (
          <>
            <section className="scheduleImportMetrics" aria-label="课表预览统计">
              <MetricCard
                label="识别课程"
                value={result.report.total}
                detail={result.format === "calendar_matrix" ? "横向周课表" : "逐行明细表"}
              />
              <MetricCard label="将新建" value={result.report.create} detail="建立课时草稿" />
              <MetricCard label="将调整" value={result.report.update} detail="仅未结算课时" />
              <MetricCard label="将跳过" value={result.report.skip} detail="已有相同课时" />
              <MetricCard label="已阻止" value={result.report.blocked} detail="冲突、无效或同名" />
            </section>

            <Panel
              className="scheduleImportReview"
              eyebrow="第 2 步"
              title="逐节核对变化"
              description={`预计新建 ${result.report.studentsToCreate} 名学生、${result.report.classesToCreate} 个班级。确认时会再次检查，避免预览后新增的冲突。`}
              actions={(
                <button
                  className="primaryButton"
                  disabled={busy || confirmed || (remainingCount === 0 && confirmableCount === 0)}
                  onClick={() => void confirmImport()}
                >
                  {confirmButtonLabel}
                </button>
              )}
            >
              <div className="scheduleImportRows">
                {(confirmed || confirmedRows.length > 0 ? confirmedRows : result.rows).map((row, index) => {
                  if (confirmed || confirmedRows.length > 0) {
                    const confirmedRow = row as ConfirmRow;
                    const meta = historyRowMeta[confirmedRow.action] || historyRowMeta.pending;
                    const source = result.rows.find((item) => item.rowNumber === confirmedRow.rowNumber);
                    const issues = confirmedRow.issue ? [confirmedRow.issue] : [];
                    return (
                      <article
                        data-action={historyPreviewAction(confirmedRow.action)}
                        key={`confirmed-${confirmedRow.id || confirmedRow.rowNumber || index}`}
                      >
                        <header>
                          <span>{source?.sourceCell || `第 ${confirmedRow.rowNumber} 行`}</span>
                          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        </header>
                        {source && (
                          <div className="scheduleImportRowMain">
                            <time>
                              <b>{source.value.date || "日期待补"}</b>
                              <span>{source.value.startTime || "?"}–{source.value.endTime || "?"}</span>
                            </time>
                            <div>
                              <h3>{source.value.courseName || "课程待补"}</h3>
                              <p>{source.value.className || source.value.studentNames.join("、") || "学生或班级待补"}</p>
                            </div>
                            <div>
                              <b>{source.value.location || "地点待补"}</b>
                              <p>
                                {source.value.fee
                                  ? `费用 ${source.value.fee} 元`
                                  : `基础 ${source.value.baseFee || 0} 元＋每生 ${source.value.perStudentFee || 0} 元`}
                              </p>
                            </div>
                          </div>
                        )}
                        {confirmedRow.lessonId && (
                          <p className="scheduleImportLinkedLesson">
                            已关联课时 · <Link href={`/lessons/${confirmedRow.lessonId}`}>查看课时</Link>
                          </p>
                        )}
                        {issues.length > 0 && <p className="scheduleImportIssues">{issues.join("；")}</p>}
                      </article>
                    );
                  }
                  const previewRow = row as PreviewRow;
                  const meta = actionMeta[previewRow.preview.action];
                  const issues = [...previewRow.issues, ...previewRow.preview.issues];
                  return (
                    <article
                      data-action={previewRow.preview.action}
                      key={`${previewRow.rowNumber}-${previewRow.sourceCell || "row"}`}
                    >
                      <header>
                        <span>{previewRow.sourceCell || `第 ${previewRow.rowNumber} 行`}</span>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </header>
                      <div className="scheduleImportRowMain">
                        <time>
                          <b>{previewRow.value.date || "日期待补"}</b>
                          <span>{previewRow.value.startTime || "?"}–{previewRow.value.endTime || "?"}</span>
                        </time>
                        <div>
                          <h3>{previewRow.value.courseName || "课程待补"}</h3>
                          <p>{previewRow.value.className || previewRow.value.studentNames.join("、") || "学生或班级待补"}</p>
                        </div>
                        <div>
                          <b>{previewRow.value.location || "地点待补"}</b>
                          <p>
                            {previewRow.value.fee
                              ? `费用 ${previewRow.value.fee} 元`
                              : `基础 ${previewRow.value.baseFee || 0} 元＋每生 ${previewRow.value.perStudentFee || 0} 元`}
                          </p>
                        </div>
                      </div>
                      {(previewRow.preview.studentsToCreate.length > 0 || previewRow.preview.classToCreate) && (
                        <div className="scheduleImportCreates">
                          {previewRow.preview.studentsToCreate.length > 0 && (
                            <span>新学生：{previewRow.preview.studentsToCreate.join("、")}</span>
                          )}
                          {previewRow.preview.classToCreate && <span>新班级：{previewRow.preview.classToCreate}</span>}
                        </div>
                      )}
                      {issues.length > 0 && (
                        <p className="scheduleImportIssues">
                          {issues.join("；")}
                          {previewRow.preview.existingLessonId && (
                            <> · <Link href={`/lessons/${previewRow.preview.existingLessonId}`}>查看相关课时</Link></>
                          )}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </Panel>
          </>
        ) : (
          <EmptyState
            title="尚未生成课表预览"
            description="选择文件并识别后，这里会逐节显示新建、调整、跳过和冲突结果。"
            icon="表"
          />
        )}
      </div>
    </AppShell>
  );
}
