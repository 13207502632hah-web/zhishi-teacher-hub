"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { ClassPicker } from "../../components/ClassPicker";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../../components/ui/Primitives";
import { HttpError, requestJson } from "../../lib/http-client";

type Row = Record<string, any>;
type PaperMode = "student" | "teacher" | "answer" | "analysis";
type PaperData = {
  paper: Row;
  questions: Row[];
  stats: {
    questionTypes: Record<string, number>;
    difficulties: Record<string, number>;
    knowledge: string[];
  };
};
type PaperReview = {
  summary: string;
  strengths: string[];
  risks: Array<{
    level: string;
    title: string;
    evidence: string;
    recommendation: string;
  }>;
  recommendedActions: string[];
  evidenceSummary: string[];
  uncertainty: string[];
};

const defaultAssignment = () => ({
  classId: "",
  dueAt: "",
  requirements: "完成整张试卷并订正错题",
});
const modeLabels: Record<PaperMode, string> = {
  student: "学生版",
  teacher: "教师版",
  answer: "答案版",
  analysis: "解析版",
};
const statusLabels: Record<string, string> = {
  draft: "草稿",
  completed: "已完成",
  used: "已使用",
  archived: "已归档",
};
const statusTone = (status: string): "neutral" | "success" | "warning" =>
  status === "used" || status === "completed"
    ? "success"
    : status === "draft"
      ? "warning"
      : "neutral";
const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError || reason instanceof Error ? reason.message : fallback;

async function requestBlob(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new HttpError(0, "网络连接异常，请检查后重试");
  }
  if (!response.ok) {
    const text = (await response.text()).trim();
    let message = "";
    if (text) {
      try {
        const payload = JSON.parse(text) as { error?: string; message?: string };
        message = payload.error || payload.message || "";
      } catch {
        message = "";
      }
    }
    throw new HttpError(response.status, message || "文件生成失败，请稍后重试");
  }
  return { blob: await response.blob(), response };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PaperDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PaperData | null>(null);
  const [mode, setMode] = useState<PaperMode>("student");
  const [message, setMessage] = useState("");
  const [paperDetailLoadError, setPaperDetailLoadError] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [files, setFiles] = useState<Row[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignment, setAssignment] = useState(defaultAssignment);
  const [aiReview, setAiReview] = useState<PaperReview | null>(null);
  const [aiReviewBusy, setAiReviewBusy] = useState(false);
  const [aiReviewMeta, setAiReviewMeta] = useState<{
    sentFields: string[];
    excludedFields: string[];
  } | null>(null);
  const documentRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const assignmentDirty =
    Boolean(assignment.classId || assignment.dueAt) ||
    assignment.requirements !== defaultAssignment().requirements;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setPaperDetailLoadError("");
    setReferenceError("");
    const requests = await Promise.allSettled([
      requestJson<PaperData>(`/api/papers/${id}`, { signal }),
      requestJson<{ files?: Row[] }>(`/api/papers/${id}/files`, { signal }),
    ]);
    if (signal?.aborted) return;
    try {
      const paperResult = requests[0];
      if (paperResult.status === "rejected") throw paperResult.reason;
      if (!paperResult.value) throw new HttpError(200, "试卷详情响应为空，请重试");
      setData(paperResult.value);

      const auxiliaryErrors: string[] = [];
      const fileResult = requests[1];
      if (fileResult.status === "fulfilled" && fileResult.value) {
        setFiles(fileResult.value.files || []);
      } else {
        setFiles([]);
        auxiliaryErrors.push("原始文件");
      }
      if (auxiliaryErrors.length) {
        setReferenceError(`${auxiliaryErrors.join("和")}暂时无法读取，试卷正文仍可查看。`);
      }
    } catch (reason) {
      setPaperDetailLoadError(errorMessage(reason, "暂时无法读取试卷"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const dismissAssignment = useCallback(() => {
    if (actionBusy) return;
    if (assignmentDirty && !window.confirm("作业信息尚未保存，确定放弃当前填写内容吗？")) return;
    setAssignOpen(false);
    setAssignment(defaultAssignment());
  }, [actionBusy, assignmentDirty]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!assignOpen || !dialog) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (focusable[0] || dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissAssignment();
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
  }, [assignOpen, dismissAssignment]);

  useEffect(() => {
    if (!assignOpen || !assignmentDirty) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [assignOpen, assignmentDirty]);

  const print = async () => {
    if (actionBusy) return;
    if (!window.confirm(`确认打印或导出${modeLabels[mode]}？`)) return;
    setActionBusy("print");
    setMessage("");
    try {
      await requestJson("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "print",
          entityType: "paper",
          entityId: id,
          detail: { mode },
        }),
      });
      window.print();
    } catch (reason) {
      setMessage(errorMessage(reason, "未能记录打印操作，请稍后重试"));
    } finally {
      setActionBusy("");
    }
  };

  const downloadDocx = async () => {
    if (exporting) return;
    setExporting("DOCX");
    setMessage("");
    try {
      const { blob, response } = await requestBlob(`/api/papers/${id}/export?mode=${mode}`);
      const encodedName =
        response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1];
      downloadBlob(
        blob,
        encodedName ? decodeURIComponent(encodedName) : `试卷-${mode}.docx`,
      );
      setMessage("可编辑 Word 已生成，请使用 WPS 或 Microsoft Word 打开检查");
    } catch (reason) {
      setMessage(errorMessage(reason, "Word 生成失败"));
    } finally {
      setExporting("");
    }
  };

  const downloadPdf = async () => {
    if (exporting || !documentRef.current || !data) return;
    setExporting("PDF");
    setMessage("");
    let jobId = "";
    try {
      const job = await requestJson<{ jobId: string; status: string }>(
        `/api/papers/${id}/export-job`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!job?.jobId) throw new HttpError(200, "PDF 任务响应为空，请重试");
      jobId = job.jobId;
      const filename = `${String(data.paper.title).replace(/[\\/:*?"<>|]/g, "-")}-${modeLabels[mode]}-${new Date().toISOString().slice(0, 10)}.pdf`;
      let blob: Blob;
      if (job.status === "completed") {
        const cached = await requestBlob(
          `/api/papers/${id}/export-job?jobId=${encodeURIComponent(job.jobId)}`,
        );
        blob = cached.blob;
      } else {
        const { jsPDF } = await import("jspdf");
        await import("html2canvas");
        const pdf = new jsPDF({
          unit: "mm",
          format: "a4",
          orientation: "portrait",
          compress: true,
        });
        await pdf.html(documentRef.current, {
          x: 14,
          y: 12,
          width: 182,
          windowWidth: 900,
          autoPaging: "text",
          html2canvas: { scale: 1.7, useCORS: true, backgroundColor: "#ffffff" },
        });
        blob = pdf.output("blob");
        const formData = new FormData();
        formData.append("jobId", job.jobId);
        formData.append("file", blob, filename);
        await requestJson(`/api/papers/${id}/export-job`, {
          method: "PUT",
          body: formData,
          timeoutMs: 45_000,
        });
      }
      downloadBlob(blob, filename);
      setMessage("PDF 已生成并保存到导出记录；建议首次使用时快速检查分页");
    } catch (reason) {
      if (jobId) {
        void requestJson(`/api/papers/${id}/export-job`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, error: errorMessage(reason, "PDF 生成失败") }),
        }).catch(() => undefined);
      }
      setMessage(errorMessage(reason, "PDF 生成失败，请稍后重试或使用打印功能"));
    } finally {
      setExporting("");
    }
  };

  const copy = async () => {
    if (actionBusy) return;
    setActionBusy("copy");
    setMessage("");
    try {
      const payload = await requestJson<{ paper?: Row }>(`/api/papers/${id}`, {
        method: "POST",
      });
      if (!payload?.paper) throw new HttpError(200, "复制响应为空，请重试");
      setMessage(`已复制为“${payload.paper.title}”`);
    } catch (reason) {
      setMessage(errorMessage(reason, "复制试卷失败"));
    } finally {
      setActionBusy("");
    }
  };

  const updateStatus = async (status: string) => {
    if (actionBusy) return;
    if (
      status === "archived" &&
      !window.confirm("确认归档这份试卷？归档后仍可查看、复制和打印。")
    ) return;
    setActionBusy(`status-${status}`);
    setMessage("");
    try {
      await requestJson(`/api/papers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setMessage(status === "archived" ? "试卷已归档" : "试卷状态已更新");
      await load();
    } catch (reason) {
      setMessage(errorMessage(reason, "更新试卷状态失败"));
    } finally {
      setActionBusy("");
    }
  };

  const assignPaper = async () => {
    if (actionBusy) return;
    if (!assignment.classId) {
      setMessage("请选择需要布置试卷的班级");
      return;
    }
    setActionBusy("assign");
    setMessage("");
    try {
      const payload = await requestJson<{ studentCount?: number }>(
        `/api/papers/${id}/files`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...assignment,
            title: `${data?.paper.title || "完整试卷"}作业`,
          }),
        },
      );
      if (!payload) throw new HttpError(200, "布置作业响应为空，请重试");
      setAssignment(defaultAssignment());
      setAssignOpen(false);
      setMessage(`已布置给 ${payload.studentCount || 0} 名学生，提交时间会用于课程反馈`);
      await load();
    } catch (reason) {
      setMessage(errorMessage(reason, "布置作业失败"));
    } finally {
      setActionBusy("");
    }
  };

  const generateAiReview = async () => {
    if (aiReviewBusy || actionBusy) return;
    setAiReviewBusy(true);
    setMessage("");
    try {
      const payload = await requestJson<{
        review?: PaperReview;
        sentFields?: string[];
        excludedFields?: string[];
      }>("/api/ai/paper-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: Number(id) }),
      });
      if (!payload?.review) throw new HttpError(200, "AI 质检响应为空，请重试");
      setAiReview(payload.review);
      setAiReviewMeta({
        sentFields: payload.sentFields || [],
        excludedFields: payload.excludedFields || [],
      });
      setMessage("AI 结构质检已完成，试卷内容未被修改");
    } catch (reason) {
      setMessage(errorMessage(reason, "AI 试卷质检失败"));
    } finally {
      setAiReviewBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <AppShell title="试卷详情">
        <div className="paperDetailLoading" role="status">正在读取试卷，请稍候…</div>
      </AppShell>
    );
  }
  if (paperDetailLoadError && !data) {
    return (
      <AppShell title="试卷详情">
        <div className="paperDetailLoadError" role="alert">
          <div>
            <strong>无法打开试卷</strong>
            <p>{paperDetailLoadError}</p>
          </div>
          <Button variant="secondary" onClick={() => void load()}>重新读取试卷</Button>
        </div>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell title="试卷详情">
        <EmptyState title="未找到试卷" description="当前试卷没有可显示的数据。" />
      </AppShell>
    );
  }

  const paper = data.paper;
  const paperStatus = String(paper.status || "draft");
  const showAnswer = ["teacher", "answer", "analysis"].includes(mode);
  const showAnalysis = ["teacher", "analysis"].includes(mode);
  const showNotes = mode === "teacher" || mode === "analysis";
  const totalScore = paper.total_score || paper.totalScore || 0;

  return (
    <AppShell
      title={String(paper.title)}
      subtitle={`${paper.type} · ${data.questions.length}题 · ${totalScore}分`}
      actions={
        <div className="paperDetailHeaderActions">
          <Button
            variant="secondary"
            disabled={Boolean(actionBusy) || Boolean(exporting)}
            onClick={copy}
          >
            {actionBusy === "copy" ? "正在复制…" : "复制试卷"}
          </Button>
          <Button
            variant="secondary"
            disabled={Boolean(actionBusy) || Boolean(exporting)}
            onClick={downloadDocx}
          >
            {exporting === "DOCX" ? "正在生成 Word…" : "导出 Word"}
          </Button>
          <Button
            variant="secondary"
            disabled={Boolean(actionBusy) || Boolean(exporting)}
            onClick={downloadPdf}
          >
            {exporting === "PDF" ? "正在生成 PDF…" : "导出 PDF"}
          </Button>
          <Button
            disabled={Boolean(actionBusy) || Boolean(exporting)}
            onClick={print}
          >
            {actionBusy === "print" ? "准备打印…" : "打印"}
          </Button>
        </div>
      }
    >
      <div className="paperDetailPage">
        {message && <div className="paperDetailNotice" role="status">{message}</div>}
        {referenceError && <div className="paperDetailReferenceError" role="alert">{referenceError}</div>}

        <div className="paperDetailTopbar">
          <div className="paperDetailModeSwitch" aria-label="试卷显示版本">
            {(Object.keys(modeLabels) as PaperMode[]).map((item) => (
              <Button
                aria-pressed={mode === item}
                className={mode === item ? "isActive" : ""}
                key={item}
                variant="quiet"
                onClick={() => setMode(item)}
              >
                {modeLabels[item]}
              </Button>
            ))}
          </div>
          <div className="paperDetailStatusActions">
            <StatusBadge tone={statusTone(paperStatus)}>
              {statusLabels[paperStatus] || paperStatus}
            </StatusBadge>
            <Button
              variant="quiet"
              disabled={Boolean(actionBusy) || paperStatus === "completed"}
              onClick={() => void updateStatus("completed")}
            >
              标记已完成
            </Button>
            <Button
              variant="quiet"
              disabled={Boolean(actionBusy) || paperStatus === "used"}
              onClick={() => void updateStatus("used")}
            >
              标记已使用
            </Button>
            <Button
              variant="danger"
              disabled={Boolean(actionBusy) || paperStatus === "archived"}
              onClick={() => void updateStatus("archived")}
            >
              归档
            </Button>
          </div>
        </div>

        <div className="paperDetailMetrics">
          <MetricCard label="题目数量" value={data.questions.length} detail="当前拆分入卷题目" />
          <MetricCard label="试卷总分" value={totalScore} detail={paper.duration_minutes || paper.durationMinutes ? `限时 ${paper.duration_minutes || paper.durationMinutes} 分钟` : "未设置限时"} />
          <MetricCard label="知识点" value={data.stats.knowledge.length} detail={data.stats.knowledge.length ? "已完成覆盖标注" : "暂未标注"} />
        </div>

        <Panel
          className="paperDetailAiPanel"
          eyebrow="DeepSeek · 组卷后辅助"
          title="试卷结构质检"
          description="仅分析题干、题型、难度、分值、知识点和缺失状态；答案、解析正文、学生信息和原卷附件不会发送，AI 不会改题或改变试卷状态。"
          actions={
            <Button
              disabled={aiReviewBusy || Boolean(actionBusy) || !data.questions.length}
              onClick={generateAiReview}
            >
              {aiReviewBusy ? "正在质检…" : aiReview ? "重新质检" : "运行 AI 结构质检"}
            </Button>
          }
        >
          {aiReview ? (
            <div className="paperDetailAiResult">
              <p>{aiReview.summary}</p>
              <div>
                <article>
                  <b>可保留之处</b>
                  <span>{aiReview.strengths.join("\n") || "未识别到有证据的优势"}</span>
                </article>
                {aiReview.risks.slice(0, 3).map((risk, index) => (
                  <article key={`${risk.title}-${index}`}>
                    <b>{risk.level}风险 · {risk.title}</b>
                    <span>{risk.evidence}{`\n`}建议：{risk.recommendation}</span>
                  </article>
                ))}
              </div>
              {aiReview.recommendedActions.length > 0 && (
                <aside>
                  <b>建议按顺序人工处理</b>
                  {aiReview.recommendedActions.map((item) => <span key={item}>{item}</span>)}
                </aside>
              )}
              {aiReview.uncertainty.length > 0 && (
                <aside>
                  <b>质检边界</b>
                  {aiReview.uncertainty.map((item) => <span key={item}>{item}</span>)}
                </aside>
              )}
              {aiReviewMeta && (
                <details>
                  <summary>查看本次发送与排除字段</summary>
                  <p>发送：{aiReviewMeta.sentFields.join("、")}</p>
                  <p>排除：{aiReviewMeta.excludedFields.join("、")}</p>
                </details>
              )}
            </div>
          ) : (
            <p className="paperDetailAiEmpty">质检只给出结构建议，不会自动修改题目或试卷状态。</p>
          )}
        </Panel>

        {files.length > 0 && (
          <Panel
            className="paperDetailFiles"
            eyebrow="原始文件"
            title="整张试卷版本"
            actions={<Button onClick={() => setAssignOpen(true)}>布置为作业</Button>}
          >
            <div className="paperDetailFileList">
              {files.map((file) => (
                <article key={file.id}>
                  <div>
                    <b>{modeLabels[file.versionType as PaperMode] || file.versionType}</b>
                    <span>{file.originalName} · {(Number(file.size) / 1024 / 1024).toFixed(1)}MB</span>
                    <small>{file.parseMessage || "原卷已保存"}</small>
                  </div>
                  <a className="zs-button zs-button--secondary" href={`/api/papers/${id}/files/${file.id}?inline=1`} target="_blank" rel="noreferrer">打开并打印原卷</a>
                  <a className="zs-button zs-button--quiet" href={`/api/papers/${id}/files/${file.id}`}>下载原文件</a>
                </article>
              ))}
            </div>
          </Panel>
        )}

        <div className="paperDetailInsights">
          <article><b>知识点覆盖</b><span>{data.stats.knowledge.length ? data.stats.knowledge.join(" · ") : "暂未标注"}</span></article>
          <article><b>题型分布</b><span>{Object.entries(data.stats.questionTypes).map(([type, count]) => `${type} ${count}题`).join(" · ") || "暂未分类"}</span></article>
          <article><b>难度分布</b><span>{Object.entries(data.stats.difficulties).map(([level, count]) => `${level}级 ${count}题`).join(" · ") || "暂未标注"}</span></article>
        </div>

        <section className="paperDocument paperDetailDocument" ref={documentRef}>
          <header>
            <h1>{paper.title}</h1>
            {paper.instructions && <p className="paperInstructions">{paper.instructions}</p>}
            <p>姓名：________　班级：________　日期：________ {paper.duration_minutes || paper.durationMinutes ? `　限时：${paper.duration_minutes || paper.durationMinutes} 分钟` : ""}</p>
          </header>
          {data.questions.length === 0 ? (
            <p className="paperDetailOriginalHint">本记录以整张原卷为主，请使用上方“打开并打印原卷”。后台拆题完成后，题目也会显示在这里。</p>
          ) : data.questions.map((question, index) => (
            <article key={String(question.id)}>
              {question.group_title && <h2 className="paperGroupTitle">{question.group_title}</h2>}
              <h3>{index + 1}．{question.stem}<span>（{question.paperScore || question.paper_score || question.score || 0}分）</span></h3>
              {question.material && <blockquote>{question.material}</blockquote>}
              {question.options && <pre>{question.options}</pre>}
              {mode === "student" && (
                <div className="answerSpace">
                  {Array.from({ length: Math.max(1, Number(question.answer_space || 2)) }, (_, line) => (
                    <p key={line}>作答：________________________________________________________________</p>
                  ))}
                </div>
              )}
              {showNotes && <div className="teacherQuestionMeta"><b>知识点：</b>{question.knowledge_points || question.knowledgePoints || "待标注"}　<b>难度：</b>{question.difficulty || "—"}级</div>}
              {showAnswer && (
                <div className="answerBlock">
                  <b>答案：</b>{question.answer || "待补充"}
                  {showAnalysis && <><br /><b>解析：</b>{question.analysis || "待补充"}{question.standard_expression && <><br /><b>规范表述：</b>{question.standard_expression}</>}</>}
                </div>
              )}
            </article>
          ))}
        </section>
      </div>

      {assignOpen && (
        <div className="modalBackdrop paperAssignmentBackdrop" role="presentation">
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="lessonModal paperAssignmentDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paper-assignment-title"
          >
            <div className="modalTitle">
              <div>
                <p>关联课程与作业</p>
                <h2 id="paper-assignment-title">布置整张试卷</h2>
              </div>
              <button aria-label="关闭" disabled={Boolean(actionBusy)} onClick={dismissAssignment}>×</button>
            </div>
            <div className="paperAssignmentForm">
              <ClassPicker value={assignment.classId} onChange={(value) => setAssignment({ ...assignment, classId: value })} placeholder="选择接收班级" />
              <label>
                预计提交时间
                <input type="datetime-local" value={assignment.dueAt} onChange={(event) => setAssignment({ ...assignment, dueAt: event.target.value })} />
              </label>
              <label className="isWide">
                作业要求
                <textarea value={assignment.requirements} onChange={(event) => setAssignment({ ...assignment, requirements: event.target.value })} />
              </label>
            </div>
            <div className="modalActions">
              <Button variant="secondary" disabled={Boolean(actionBusy)} onClick={dismissAssignment}>取消</Button>
              <Button disabled={Boolean(actionBusy)} onClick={assignPaper}>
                {actionBusy === "assign" ? "正在布置…" : "确认布置"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
