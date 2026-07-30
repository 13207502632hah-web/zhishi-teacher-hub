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
type ImportResult = {
  id: number;
  format: "calendar_matrix" | "tabular";
  rows: PreviewRow[];
  report: PreviewReport;
};
type ConfirmReport = {
  created?: number;
  updated?: number;
  skipped?: number;
  blocked?: number;
  studentsCreated?: number;
};
type BusyAction = "" | "upload" | "confirm";

const actionMeta: Record<
  PreviewAction,
  { label: string; tone: "success" | "info" | "neutral" | "danger" }
> = {
  create: { label: "将新建", tone: "success" },
  update: { label: "将调整", tone: "info" },
  skip: { label: "将跳过", tone: "neutral" },
  blocked: { label: "已阻止", tone: "danger" },
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
  const busy = Boolean(busyAction);
  const hasUnsavedPreview = Boolean(result && !confirmed);
  const confirmableCount = (result?.report.create || 0) + (result?.report.update || 0);

  useEffect(() => {
    const protectPreview = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedPreview) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPreview);
    return () => window.removeEventListener("beforeunload", protectPreview);
  }, [hasUnsavedPreview]);

  const upload = async (allowDuplicate = false) => {
    if (!file || busy) return;
    setBusyAction("upload");
    setMessage("正在识别课表并检查现有课时…");
    setDuplicateAvailable(false);
    setConfirmed(false);
    try {
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
      setResult(data);
      setMessage(
        `已识别 ${data.report.total} 节：将新建 ${data.report.create} 节、调整 ${data.report.update} 节、跳过 ${data.report.skip} 节、阻止 ${data.report.blocked} 节。`,
      );
    } catch (reason) {
      setResult(null);
      if (reason instanceof HttpError && reason.status === 409) {
        setDuplicateAvailable(true);
        setMessage(`${reason.message}。如课表确有修改，可重新比较，不会立即写入课时。`);
      } else {
        setMessage(errorMessage(reason, "课表识别失败，请检查文件后重试"));
      }
    } finally {
      setBusyAction("");
    }
  };

  const confirmImport = async () => {
    if (!result || busy || confirmed || confirmableCount === 0) return;
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
      const data = await requestJson<{
        repeated?: boolean;
        report?: ConfirmReport;
      }>(`/api/schedule-imports/${result.id}/confirm`, { method: "POST" });
      const report = data?.report;
      if (!report) throw new HttpError(200, "导入响应不完整，请到课时列表核对");
      setConfirmed(true);
      setMessage(
        `${data?.repeated ? "该任务此前已完成。" : "导入完成："}新建 ${report.created || 0} 节、调整 ${report.updated || 0} 节、跳过 ${report.skipped || 0} 节、阻止 ${report.blocked || 0} 节。`,
      );
    } catch (reason) {
      setMessage(errorMessage(reason, "确认写入失败，尚未完成的行可重试"));
    } finally {
      setBusyAction("");
    }
  };

  const selectFile = (nextFile?: File) => {
    setFile(nextFile || null);
    setResult(null);
    setConfirmed(false);
    setDuplicateAvailable(false);
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
                  disabled={busy || confirmed || confirmableCount === 0}
                  onClick={() => void confirmImport()}
                >
                  {confirmed
                    ? "已确认导入"
                    : busyAction === "confirm"
                      ? "正在确认写入…"
                      : `确认导入 ${confirmableCount} 节有效课程`}
                </button>
              )}
            >
              <div className="scheduleImportRows">
                {result.rows.map((row) => {
                  const meta = actionMeta[row.preview.action];
                  const issues = [...row.issues, ...row.preview.issues];
                  return (
                    <article
                      data-action={row.preview.action}
                      key={`${row.rowNumber}-${row.sourceCell || "row"}`}
                    >
                      <header>
                        <span>{row.sourceCell || `第 ${row.rowNumber} 行`}</span>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </header>
                      <div className="scheduleImportRowMain">
                        <time>
                          <b>{row.value.date || "日期待补"}</b>
                          <span>{row.value.startTime || "?"}–{row.value.endTime || "?"}</span>
                        </time>
                        <div>
                          <h3>{row.value.courseName || "课程待补"}</h3>
                          <p>{row.value.className || row.value.studentNames.join("、") || "学生或班级待补"}</p>
                        </div>
                        <div>
                          <b>{row.value.location || "地点待补"}</b>
                          <p>
                            {row.value.fee
                              ? `费用 ${row.value.fee} 元`
                              : `基础 ${row.value.baseFee || 0} 元＋每生 ${row.value.perStudentFee || 0} 元`}
                          </p>
                        </div>
                      </div>
                      {(row.preview.studentsToCreate.length > 0 || row.preview.classToCreate) && (
                        <div className="scheduleImportCreates">
                          {row.preview.studentsToCreate.length > 0 && (
                            <span>新学生：{row.preview.studentsToCreate.join("、")}</span>
                          )}
                          {row.preview.classToCreate && <span>新班级：{row.preview.classToCreate}</span>}
                        </div>
                      )}
                      {issues.length > 0 && (
                        <p className="scheduleImportIssues">
                          {issues.join("；")}
                          {row.preview.existingLessonId && (
                            <> · <Link href={`/lessons/${row.preview.existingLessonId}`}>查看相关课时</Link></>
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
