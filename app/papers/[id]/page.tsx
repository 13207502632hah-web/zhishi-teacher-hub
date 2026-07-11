"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, EmptyState } from "../../components/AppShell";

type PaperData = { paper: Record<string, any>; questions: Array<Record<string, any>>; stats: { questionTypes: Record<string, number>; difficulties: Record<string, number>; knowledge: string[] } };

export default function PaperDetail() {
  const { id } = useParams<{ id: string }>(), [data, setData] = useState<PaperData | null>(null), [mode, setMode] = useState("student"), [message, setMessage] = useState("");
  const load = useCallback(async () => { try { const response = await fetch(`/api/papers/${id}`), payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法读取试卷"); setData(payload); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "无法读取试卷"); } }, [id]);
  useEffect(() => { void load(); }, [load]);
  const print = async () => { if (!confirm(`确认打印或导出${mode === "student" ? "学生版" : mode === "teacher" ? "教师备课版" : "答案解析版"}？`)) return; const response = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "paper", entityId: id, detail: { mode } }) }); if (!response.ok) { setMessage("未能记录导出操作，请稍后重试"); return; } window.print(); };
  const copy = async () => { const response = await fetch(`/api/papers/${id}`, { method: "POST" }), payload = await response.json(); if (!response.ok) { setMessage(payload.error || "复制试卷失败"); return; } setMessage(`已复制为“${payload.paper.title}”`); };
  if (message && !data) return <AppShell title="试卷详情"><EmptyState title="无法打开试卷" description={message} action={<button className="secondaryButton" onClick={load}>重新读取</button>} /></AppShell>;
  if (!data) return <AppShell title="试卷详情"><EmptyState title="正在读取试卷" description="请稍候…" /></AppShell>;
  const paper = data.paper, showAnswer = mode === "answer", showNotes = mode === "teacher" || mode === "answer";
  return <AppShell title={String(paper.title)} subtitle={`${paper.type} · ${data.questions.length}题 · ${paper.total_score || paper.totalScore || 0}分`} actions={<><button className="secondaryButton" onClick={copy}>复制试卷</button><button className="primaryButton" onClick={print}>打印 / 导出</button></>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    <div className="viewSwitch"><button className={mode === "student" ? "active" : ""} onClick={() => setMode("student")}>学生版</button><button className={mode === "teacher" ? "active" : ""} onClick={() => setMode("teacher")}>教师备课版</button><button className={mode === "answer" ? "active" : ""} onClick={() => setMode("answer")}>答案解析版</button></div>
    <section className="paperInsights"><div><b>知识点覆盖</b><span>{data.stats.knowledge.length ? data.stats.knowledge.join(" · ") : "暂未标注"}</span></div><div><b>题型分布</b><span>{Object.entries(data.stats.questionTypes).map(([type, count]) => `${type} ${count}题`).join(" · ") || "暂未分类"}</span></div><div><b>难度分布</b><span>{Object.entries(data.stats.difficulties).map(([level, count]) => `${level}级 ${count}题`).join(" · ") || "暂未标注"}</span></div></section>
    <section className="paperDocument"><header><h1>{paper.title}</h1>{paper.instructions && <p className="paperInstructions">{paper.instructions}</p>}<p>姓名：________　班级：________　日期：________ {paper.duration_minutes || paper.durationMinutes ? `　限时：${paper.duration_minutes || paper.durationMinutes} 分钟` : ""}</p></header>{data.questions.map((question, index) => <article key={String(question.id)}><h3>{index + 1}．{question.stem}<span>（{question.paperScore || question.paper_score || question.score || 0}分）</span></h3>{question.material && <blockquote>{question.material}</blockquote>}{question.options && <pre>{question.options}</pre>}{mode === "student" && <div className="answerSpace">作答：________________________________________________________________</div>}{showNotes && <div className="teacherQuestionMeta"><b>知识点：</b>{question.knowledge_points || question.knowledgePoints || "待标注"}　<b>难度：</b>{question.difficulty || "—"}级</div>}{showAnswer && <div className="answerBlock"><b>答案：</b>{question.answer || "待补充"}<br /><b>解析：</b>{question.analysis || "待补充"}{question.standard_expression && <><br /><b>规范表述：</b>{question.standard_expression}</>}</div>}</article>)}</section>
  </AppShell>;
}
