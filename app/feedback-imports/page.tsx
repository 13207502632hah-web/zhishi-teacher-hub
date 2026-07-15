"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { recognizeChineseImage } from "../lib/local-ocr";

type Parsed = { studentName: string; studentId: number | null; date: string; startTime: string; endTime: string; location: string; actualContent: string; homework: string; nextPlan: string; confidence: number; evidence: Array<{ field: string; excerpt: string; confidence: number }> };
const empty: Parsed = { studentName: "", studentId: null, date: "", startTime: "", endTime: "", location: "", actualContent: "", homework: "", nextPlan: "", confidence: 0, evidence: [] };

export default function FeedbackImportsPage() {
  const [sourceText, setSourceText] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [sourceAssetId, setSourceAssetId] = useState<number | null>(null);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [matchedLessonId, setMatchedLessonId] = useState<number | null>(null);
  const [parsed, setParsed] = useState<Parsed>(empty);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [students, setStudents] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => { void fetch("/api/students").then((response) => response.json()).then((data) => setStudents(data.students || [])); }, []);

  const recognize = async (file?: File) => {
    if (!file) return;
    setBusy(true); setMessage("正在本机识别图片，首次加载中文模型会稍慢…"); setProgress(0);
    try {
      const upload = new FormData(); upload.set("file", file); upload.set("purpose", "feedback-import"); upload.set("ownerType", "feedback_import");
      const [result, stored] = await Promise.all([recognizeChineseImage(file, (item) => setProgress(Math.round(item.progress * 100))), fetch("/api/files", { method: "POST", body: upload }).then(async (response) => ({ ok: response.ok, data: await response.json() }))]);
      if (!stored.ok) throw new Error(stored.data.error || "反馈原图保存失败");
      setSourceAssetId(Number(stored.data.id));
      setOcrText(result.text); setMessage(result.text ? `本机OCR完成（整体置信度约 ${Math.round(result.confidence * 100)}%），请核对原图与文字。` : "没有识别出文字，请换一张更清晰、方向正确的图片。");
    } catch (error) { setMessage(error instanceof Error ? `OCR失败：${error.message}` : "OCR失败，请改用粘贴文字"); }
    finally { setBusy(false); }
  };
  const parse = async () => {
    setBusy(true); setMessage("");
    const response = await fetch("/api/feedback-imports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceText, ocrText, sourceAssetId }) }), data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "解析失败"); return; }
    setTaskId(data.id); setParsed(data.parsed); setMatchedLessonId(data.matchedLessonId || null); setMessage("已生成草稿。低置信字段必须由您核对，当前不会创建课时或发布作业。");
  };
  const confirm = async () => {
    if (!taskId) return;
    setBusy(true);
    const saved = await fetch(`/api/feedback-imports/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parsed, confidence: parsed.confidence, matchedLessonId }) });
    if (!saved.ok) { const data = await saved.json(); setMessage(data.error || "草稿保存失败"); setBusy(false); return; }
    const response = await fetch(`/api/feedback-imports/${taskId}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId: matchedLessonId, mode: matchedLessonId ? "update" : "create" }) }), data = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(data.error || "确认失败"); return; }
    setMessage(`已${data.repeated ? "保持" : "建立"}课时草稿${data.assignmentDraft ? "，并生成未发布作业草稿" : ""}。`); setMatchedLessonId(data.lessonId);
  };
  const field = (key: keyof Parsed, label: string, type = "text") => <label>{label}<input type={type} value={String(parsed[key] || "")} onChange={(event) => setParsed({ ...parsed, [key]: event.target.value })} /></label>;
  return <AppShell title="反馈反向解析" subtitle="文字或图片只生成可核对草稿；不会自动发布作业">
    {message && <div className="saveToast" role="status">{message}</div>}
    <section className="panel feedbackImportSource"><h2>第1步：提供课程反馈</h2><p>推荐保留“学生、日期、上课时段、地点、课程内容、作业、下节计划”等标题。图片OCR仅在当前浏览器运行。</p><textarea rows={10} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder={"学生：张三\n日期：2026年7月27日\n时间：8:00-10:00\n地点：晶彩大厦\n课程内容：…\n作业：…\n下节计划：…"} /><div className="workflowActions"><label className="uploadButton">选择反馈图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void recognize(event.target.files?.[0])} /></label><button className="primaryButton" disabled={busy || (!sourceText.trim() && !ocrText.trim())} onClick={() => void parse()}>{busy ? `处理中 ${progress || ""}%` : "解析为课时草稿"}</button></div>{ocrText && <details><summary>核对OCR原文</summary><textarea rows={10} value={ocrText} onChange={(event) => setOcrText(event.target.value)} /></details>}</section>
    {taskId && <section className="panel feedbackImportReview"><div><h2>第2步：逐项核对</h2><span className={parsed.confidence >= .8 ? "confidenceGood" : "confidenceLow"}>综合置信度 {Math.round(parsed.confidence * 100)}%</span></div><div className="formGrid"><label>匹配在读学生<select value={parsed.studentId || ""} onChange={(event) => { const student = students.find((item) => item.id === Number(event.target.value)); setParsed({ ...parsed, studentId: student?.id || null, studentName: student?.name || "" }); }}><option value="">【存疑】请选择</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>{field("date", "日期", "date")}{field("startTime", "开始时间", "time")}{field("endTime", "结束时间", "time")}{field("location", "上课地点")}<label className="wide">实际教学内容<textarea value={parsed.actualContent} onChange={(event) => setParsed({ ...parsed, actualContent: event.target.value })} /></label><label className="wide">作业（确认后仅建立未发布草稿）<textarea value={parsed.homework} onChange={(event) => setParsed({ ...parsed, homework: event.target.value })} /></label><label className="wide">下节计划<textarea value={parsed.nextPlan} onChange={(event) => setParsed({ ...parsed, nextPlan: event.target.value })} /></label></div><div className="evidencePanel"><b>原文证据</b>{parsed.evidence.map((item, index) => <span key={`${item.field}-${index}`}>{item.field} · {Math.round(item.confidence * 100)}%：{item.excerpt}</span>)}</div><div className="workflowActions"><button className="primaryButton" disabled={busy || !parsed.studentId || !parsed.date || !parsed.startTime || !parsed.endTime} onClick={() => void confirm()}>确认并建立/关联课时草稿</button>{matchedLessonId && <Link className="secondaryButton" href={`/lessons/${matchedLessonId}`}>打开对应课时</Link>}</div>{!parsed.studentId && <p className="fieldWarning">当前姓名未匹配在读学生，请从名单中人工选择；系统不会凭文本猜测。</p>}</section>}
  </AppShell>;
}
