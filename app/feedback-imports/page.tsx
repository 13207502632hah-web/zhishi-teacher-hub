"use client";

import Link from "@/app/components/HardNavigationLink";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Panel, StatusBadge } from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";
import { recognizeChineseImage } from "../lib/local-ocr";

type Parsed = {
  studentName: string;
  studentId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  actualContent: string;
  homework: string;
  nextPlan: string;
  confidence: number;
  evidence: Array<{ field: string; excerpt: string; confidence: number }>;
};
type BusyAction = "" | "ocr" | "parse" | "confirm";

const empty: Parsed = {
  studentName: "",
  studentId: null,
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  actualContent: "",
  homework: "",
  nextPlan: "",
  confidence: 0,
  evidence: [],
};

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError ? reason.message : fallback;

export default function FeedbackImportsPage() {
  const [sourceText, setSourceText] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [sourceAssetId, setSourceAssetId] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [matchedLessonId, setMatchedLessonId] = useState<number | null>(null);
  const [parsed, setParsed] = useState<Parsed>(empty);
  const [message, setMessage] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [progress, setProgress] = useState(0);
  const [students, setStudents] = useState<Array<{ id: number; name: string }>>([]);
  const [studentLoadError, setStudentLoadError] = useState("");
  const [studentReloadKey, setStudentReloadKey] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const busy = Boolean(busyAction);
  const hasUnsavedWork = !confirmed && Boolean(sourceText.trim() || ocrText.trim() || taskId);

  useEffect(() => {
    const controller = new AbortController();
    setStudentLoadError("");
    void requestJson<{ students?: Array<{ id: number; name: string }> }>("/api/students", {
      signal: controller.signal,
    }).then((data) => {
      if (!data) throw new HttpError(200, "学生名单响应为空，请重试");
      setStudents(data.students || []);
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setStudentLoadError(errorMessage(reason, "暂时无法读取学生名单"));
      }
    });
    return () => controller.abort();
  }, [studentReloadKey]);

  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWork) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [hasUnsavedWork]);

  const updateParsed = (next: Parsed) => {
    setParsed(next);
    setConfirmed(false);
  };

  const recognize = async (file?: File) => {
    if (!file) return;
    if (busy) return;
    setBusyAction("ocr");
    setConfirmed(false);
    setMessage("正在本机识别图片，首次加载中文模型会稍慢…");
    setProgress(0);
    try {
      const upload = new FormData();
      upload.set("file", file);
      upload.set("purpose", "feedback-import");
      upload.set("ownerType", "feedback_import");
      const [result, stored] = await Promise.all([
        recognizeChineseImage(file, (item) => setProgress(Math.round(item.progress * 100))),
        requestJson<{ id?: number }>("/api/files", { method: "POST", body: upload }),
      ]);
      if (!stored?.id) throw new HttpError(200, "反馈原图保存响应不完整，请重试");
      setSourceAssetId(Number(stored.id));
      setOcrText(result.text);
      setMessage(
        result.text
          ? `本机 OCR 完成（整体置信度约 ${Math.round(result.confidence * 100)}%），请核对原图与文字。`
          : "没有识别出文字，请换一张更清晰、方向正确的图片。",
      );
    } catch (reason) {
      setMessage(`OCR 失败：${errorMessage(reason, "请改用粘贴文字")}`);
    } finally {
      setBusyAction("");
    }
  };

  const parse = async () => {
    if (busy) return;
    if (!sourceText.trim() && !ocrText.trim()) {
      setMessage("请先粘贴反馈文字，或选择图片完成本机 OCR");
      return;
    }
    setBusyAction("parse");
    setProgress(0);
    setMessage("");
    try {
      const data = await requestJson<{
        id?: number;
        parsed?: Parsed;
        matchedLessonId?: number | null;
      }>("/api/feedback-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, ocrText, sourceAssetId }),
      });
      if (!data?.id || !data.parsed) throw new HttpError(200, "反馈解析响应不完整，请重试");
      setTaskId(Number(data.id));
      updateParsed(data.parsed);
      setMatchedLessonId(data.matchedLessonId || null);
      setMessage("已生成草稿。低置信字段必须由您核对，当前不会创建课时或发布作业。");
    } catch (reason) {
      setMessage(errorMessage(reason, "解析失败，请核对原文后重试"));
    } finally {
      setBusyAction("");
    }
  };

  const confirm = async () => {
    if (busy) return;
    if (!taskId) return;
    if (!parsed.studentId || !parsed.date || !parsed.startTime || !parsed.endTime) {
      setMessage("请先确认学生、日期和完整时段");
      return;
    }
    const target = matchedLessonId
      ? `更新已匹配的课时草稿 #${matchedLessonId}`
      : "建立一条新的课时草稿";
    if (!window.confirm(`确认${target}？作业只会建立未发布作业草稿，不会发送给学生。`)) return;

    setBusyAction("confirm");
    setMessage("");
    let draftSaved = false;
    try {
      await requestJson(`/api/feedback-imports/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed, confidence: parsed.confidence, matchedLessonId }),
      });
      draftSaved = true;
      const data = await requestJson<{
        repeated?: boolean;
        lessonId?: number;
        assignmentDraft?: boolean;
      }>(`/api/feedback-imports/${taskId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId: matchedLessonId,
          mode: matchedLessonId ? "update" : "create",
        }),
      });
      if (!data?.lessonId) throw new HttpError(200, "确认响应不完整，请检查课时列表");
      setMessage(
        `已${data.repeated ? "保持" : "建立"}课时草稿${data.assignmentDraft ? "，并生成未发布作业草稿" : ""}。`,
      );
      setMatchedLessonId(Number(data.lessonId));
      setConfirmed(true);
    } catch (reason) {
      const detail = errorMessage(reason, "确认写入失败");
      setMessage(draftSaved ? `草稿已保存，但${detail}` : detail);
    } finally {
      setBusyAction("");
    }
  };

  const field = (key: keyof Parsed, label: string, type = "text") => (
    <label>
      {label}
      <input
        disabled={busy || confirmed}
        type={type}
        value={String(parsed[key] || "")}
        onChange={(event) => updateParsed({ ...parsed, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <AppShell
      title="反馈反向解析"
      subtitle="从已发送反馈还原可核对课时草稿，所有写入仍由教师确认"
    >
      <div className="feedbackImportPage">
        <ol className="feedbackImportSteps" aria-label="反馈解析步骤">
          <li data-state={taskId ? "complete" : "current"}>
            <span>1</span>
            <div><b>提供来源</b><small>粘贴文字或本机 OCR</small></div>
          </li>
          <li data-state={taskId ? "current" : "upcoming"}>
            <span>2</span>
            <div><b>逐项核对</b><small>教师确认后才写入</small></div>
          </li>
        </ol>

        {message && <div className="feedbackImportNotice" role="status">{message}</div>}

        {studentLoadError && (
          <div className="feedbackImportLoadError" role="alert">
            <div>
              <strong>学生名单读取失败</strong>
              <p>{studentLoadError}</p>
            </div>
            <button className="secondaryButton" onClick={() => setStudentReloadKey((value) => value + 1)}>
              重新读取学生名单
            </button>
          </div>
        )}

        <Panel
          className="feedbackImportSource"
          eyebrow="第 1 步"
          title="提供课程反馈"
          description="推荐保留学生、日期、上课时段、地点、课程内容、作业和下节计划等标题。图片 OCR 仅在当前浏览器运行。"
        >
          <label className="feedbackImportText">
            反馈原文
            <textarea
              rows={10}
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.target.value);
                setConfirmed(false);
              }}
              placeholder={"学生：张三\n日期：2026年7月27日\n时间：8:00-10:00\n地点：晶彩大厦\n课程内容：…\n作业：…\n下节计划：…"}
            />
          </label>
          <div className="feedbackImportActions">
            <label className={`feedbackImportUpload${busy ? " isDisabled" : ""}`}>
              选择反馈图片
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void recognize(file);
                }}
              />
            </label>
            <button
              className="primaryButton"
              disabled={busy || (!sourceText.trim() && !ocrText.trim())}
              onClick={() => void parse()}
            >
              {busyAction === "ocr"
                ? `本机识别中 ${progress}%`
                : busyAction === "parse"
                  ? "正在解析…"
                  : "解析为课时草稿"}
            </button>
          </div>
          {ocrText && (
            <details className="feedbackImportOcr">
              <summary>核对 OCR 原文</summary>
              <textarea
                rows={10}
                value={ocrText}
                onChange={(event) => {
                  setOcrText(event.target.value);
                  setConfirmed(false);
                }}
              />
            </details>
          )}
        </Panel>

        {taskId && (
          <Panel
            className="feedbackImportReview"
            eyebrow="第 2 步"
            title="逐项核对"
            description="低置信字段和姓名匹配必须人工确认，系统不会凭文本猜测学生身份。"
            actions={(
              <StatusBadge tone={parsed.confidence >= 0.8 ? "success" : "warning"}>
                综合置信度 {Math.round(parsed.confidence * 100)}%
              </StatusBadge>
            )}
          >
            <div className="feedbackImportForm">
              <label>
                匹配在读学生
                <select
                  disabled={busy || confirmed}
                  value={parsed.studentId || ""}
                  onChange={(event) => {
                    const student = students.find((item) => item.id === Number(event.target.value));
                    updateParsed({
                      ...parsed,
                      studentId: student?.id || null,
                      studentName: student?.name || "",
                    });
                  }}
                >
                  <option value="">【存疑】请选择</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>{student.name}</option>
                  ))}
                </select>
              </label>
              {field("date", "日期", "date")}
              {field("startTime", "开始时间", "time")}
              {field("endTime", "结束时间", "time")}
              {field("location", "上课地点")}
              <label className="wide">
                实际教学内容
                <textarea
                  disabled={busy || confirmed}
                  value={parsed.actualContent}
                  onChange={(event) => updateParsed({ ...parsed, actualContent: event.target.value })}
                />
              </label>
              <label className="wide">
                作业（确认后仅建立未发布草稿，即未发布作业草稿）
                <textarea
                  disabled={busy || confirmed}
                  value={parsed.homework}
                  onChange={(event) => updateParsed({ ...parsed, homework: event.target.value })}
                />
              </label>
              <label className="wide">
                下节计划
                <textarea
                  disabled={busy || confirmed}
                  value={parsed.nextPlan}
                  onChange={(event) => updateParsed({ ...parsed, nextPlan: event.target.value })}
                />
              </label>
            </div>

            <section className="feedbackImportEvidence" aria-label="原文证据">
              <b>原文证据</b>
              {parsed.evidence.length ? (
                <ul>
                  {parsed.evidence.map((item, index) => (
                    <li key={`${item.field}-${index}`}>
                      <span>{item.field} · {Math.round(item.confidence * 100)}%</span>
                      <p>{item.excerpt}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>解析结果未提供字段证据，请完全依照原文人工核对。</p>
              )}
            </section>

            {!parsed.studentId && (
              <p className="feedbackImportWarning" role="alert">
                当前姓名未匹配在读学生，请从名单中人工选择；系统不会凭文本猜测。
              </p>
            )}

            <div className="feedbackImportActions">
              <button
                className="primaryButton"
                disabled={
                  busy ||
                  confirmed ||
                  !parsed.studentId ||
                  !parsed.date ||
                  !parsed.startTime ||
                  !parsed.endTime
                }
                onClick={() => void confirm()}
              >
                {confirmed
                  ? "已确认写入"
                  : busyAction === "confirm"
                    ? "正在确认…"
                    : "确认并建立 / 关联课时草稿"}
              </button>
              {matchedLessonId && (
                <Link className="secondaryButton" href={`/lessons/${matchedLessonId}`}>
                  打开对应课时
                </Link>
              )}
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
