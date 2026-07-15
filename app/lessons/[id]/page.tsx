"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell, EmptyState } from "../../components/AppShell";

type Lesson = Record<string, any>;
type Member = Record<string, any> & { id: number; name: string };
type Activity = { members: Member[]; assignments: Array<Record<string, any>>; feedback: Array<Record<string, any>>; reflections: Array<Record<string, any>>; questions: Array<Record<string, any>>; finance: Record<string, any> | null };
const empty: Activity = { members: [], assignments: [], feedback: [], reflections: [], questions: [], finance: null };
const blankClosure = { actualContent: "", homework: "", nextPlan: "", participation: "", understanding: "", completion: "", discipline: "" };

export default function LessonDetail() {
  const { id } = useParams<{ id: string }>();
  const [lesson, setLesson] = useState<Lesson | null>(null), [activity, setActivity] = useState<Activity>(empty);
  const [records, setRecords] = useState<Record<number, Record<string, string | boolean>>>({});
  const [assignment, setAssignment] = useState({ title: "课后作业", requirements: "", dueAt: "" });
  const [feedback, setFeedback] = useState({ studentId: "", tone: "专业简洁", content: "" });
  const [closure, setClosure] = useState(blankClosure), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [remainingTodos, setRemainingTodos] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [lessonResponse, activityResponse] = await Promise.all([fetch(`/api/lessons/${id}`), fetch(`/api/lessons/${id}/activity`)]);
    const lessonData = await lessonResponse.json(), activityData = await activityResponse.json();
    if (!lessonData.lesson) { setError(lessonData.error || "读取失败"); return; }
    setLesson(lessonData.lesson);
    setClosure({ actualContent: String(lessonData.lesson.actualContent || ""), homework: String(lessonData.lesson.homework || ""), nextPlan: String(lessonData.lesson.nextPlan || ""), participation: String(lessonData.lesson.participation || ""), understanding: String(lessonData.lesson.understanding || ""), completion: String(lessonData.lesson.completion || ""), discipline: String(lessonData.lesson.discipline || "") });
    setActivity({ ...empty, ...activityData });
    const next: Record<number, Record<string, string | boolean>> = {};
    for (const member of activityData.members || []) next[member.id] = { attendanceStatus: String(member.attendanceStatus || ""), attendanceNote: String(member.attendanceNote || ""), participation: String(member.participation || ""), understanding: String(member.understanding || ""), completion: String(member.completion || ""), teacherNote: String(member.teacherNote || ""), riskTags: String(member.riskTags || ""), riskConfirmed: Boolean(member.riskConfirmed) };
    setRecords(next); setDirty(false); setError("");
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty) return; event.preventDefault(); event.returnValue = ""; }; addEventListener("beforeunload", warn); return () => removeEventListener("beforeunload", warn); }, [dirty]);

  const setClosureField = (key: keyof typeof closure, value: string) => { setClosure({ ...closure, [key]: value }); setDirty(true); };
  const setRecord = (studentId: number, key: string, value: string | boolean) => { setRecords({ ...records, [studentId]: { ...records[studentId], [key]: value } }); setDirty(true); };
  const serializedRecords = () => Object.entries(records).map(([studentId, row]) => ({ studentId: Number(studentId), ...row }));
  const attendanceReady = activity.members.length === 0 || activity.members.every((member) => ["present", "late", "absent", "leave"].includes(String(records[member.id]?.attendanceStatus || "")));
  const steps = useMemo(() => [
    ["签到", attendanceReady], ["教学内容", Boolean(closure.actualContent.trim())], ["课堂表现", Boolean(closure.participation || closure.understanding || closure.completion)], ["作业", Boolean(assignment.requirements || assignment.dueAt || activity.assignments.length)], ["反馈", Boolean(feedback.content || activity.feedback.length)], ["下节计划", Boolean(closure.nextPlan.trim())],
  ] as const, [activity.assignments.length, activity.feedback.length, assignment.dueAt, assignment.requirements, attendanceReady, closure, feedback.content]);

  const saveWorkflow = async (action: "saveDraft" | "completeLesson") => {
    setBusy(true); setMessage(""); setRemainingTodos([]);
    const body: Record<string, unknown> = { action, ...closure, records: serializedRecords() };
    if (action === "completeLesson") {
      body.assignment = assignment.requirements || assignment.dueAt ? assignment : null;
      body.feedback = feedback.content ? feedback : null;
    }
    const response = await fetch(`/api/lessons/${id}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(data.errors?.join("；") || data.error || "保存失败，已填写内容仍保留在页面中"); return; }
    setDirty(false); setRemainingTodos(data.todos || []);
    if (action === "saveDraft") setMessage("草稿已保存，课时状态未改变");
    else setMessage(`本节课已完成；作业、反馈与结算已同步${data.artifacts?.financeLocked ? "（已确认账目保持不变）" : ""}`);
    await load();
  };

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/lessons/${id}/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    setMessage(response.ok ? "已保存" : data.error || "保存失败，请检查后重试");
    if (response.ok) await load();
  };

  if (error) return <AppShell title="课时详情"><EmptyState title="无法打开课时" description={error} /></AppShell>;
  if (!lesson) return <AppShell title="课时详情"><EmptyState title="正在读取课时" description="请稍候…" /></AppShell>;
  const timeline = (label: string, value: unknown) => <div className="timelineItem"><i></i><div><span>{label}</span><p>{String(value || "尚未记录")}</p></div></div>;
  const financeLabel = activity.finance?.status === "review" ? "待核对" : activity.finance?.status === "settled" ? "已结算" : activity.finance?.status ? "已确认" : "完成时生成";

  return <AppShell title={String(lesson.topic || lesson.courseName)} subtitle={`${lesson.date} · ${lesson.grade} · ${lesson.status === "completed" ? "已完成" : "待记录"}`} actions={<><Link href={`/lessons?edit=${id}`} className="secondaryButton">编辑课时</Link><button className="primaryButton" onClick={async () => { if (!confirm("确认打印或导出当前课时记录？打印预览中可选择“另存为 PDF”。")) return; await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "print", entityType: "lesson", entityId: id }) }); window.print(); }}>打印 / 导出 PDF</button></>}>
    {message && <div className="saveToast" role="status">{message}</div>}
    {remainingTodos.length > 0 && <div className="noticeStrip"><b>本节课仍有待办</b><span>{remainingTodos.join("、")}</span></div>}
    <div className="lessonDetailGrid">
      <section className="panel lessonSummary"><div className="panelTitle"><div><p>课程信息</p><h2>{String(lesson.courseName)}</h2></div><span className={`statusBadge ${lesson.status}`}>{lesson.status === "completed" ? "已完成" : "待记录"}</span></div><dl><div><dt>时间</dt><dd>{lesson.date}　{lesson.startTime || "待定"}–{lesson.endTime || "待定"}</dd></div><div><dt>授课</dt><dd>{lesson.mode === "online" ? `线上 · ${lesson.onlineLink || "未填写链接"}` : `线下 · ${lesson.location || "未填写地点"}`}</dd></div><div><dt>教材</dt><dd>{lesson.textbookVersion || "未填写"} · {lesson.volume || "未填写"} · {lesson.unit || "未填写单元"}</dd></div><div><dt>结算</dt><dd>{financeLabel}{activity.finance?.expectedAmount != null ? ` · ¥${Number(activity.finance.expectedAmount).toFixed(2)}` : ""}</dd></div></dl><div className="ratingSummary">{[["参与度", lesson.participation], ["理解度", lesson.understanding], ["完成度", lesson.completion], ["纪律", lesson.discipline]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value ? `${value}/5` : "待评"}</b></div>)}</div></section>

      <section className="panel lessonTimeline"><div className="panelTitle"><div><p>完整记录</p><h2>教学时间线</h2></div></div>{timeline("课前 · 教学目标", lesson.teachingGoals)}{timeline("课前 · 重点与难点", `${lesson.keyPoints || "尚未记录"}\n${lesson.difficultPoints || ""}`)}{timeline("课堂 · 实际内容", lesson.actualContent)}{timeline("课堂 · 使用资料与活动", `${lesson.materials || "尚未记录"}\n${lesson.activities || ""}`)}{timeline("课后 · 作业", lesson.homework)}{timeline("课后 · 下次课计划", lesson.nextPlan)}</section>

      <section className="panel widePanel lessonClosure"><div className="panelTitle"><div><p>同一页保存，减少重复录入</p><h2>完成本节课</h2></div><span className={dirty ? "saveState dirty" : "saveState"}>{dirty ? "有未保存修改" : "内容已保存"}</span></div><ol className="closureSteps" aria-label="完成课时步骤">{steps.map(([label, done]) => <li className={done ? "done" : ""} key={label}>{done ? "✓ " : ""}{label}</li>)}</ol><div className="formGrid"><label className="wide"><b className="stepLabel">必填 · 教学内容</b>实际教学内容<textarea value={closure.actualContent} onChange={(event) => setClosureField("actualContent", event.target.value)} placeholder="记录本节实际完成的知识、问题和活动" /></label><label><b className="stepLabel">可稍后补充 · 作业</b>本节作业<textarea value={closure.homework} onChange={(event) => setClosureField("homework", event.target.value)} /></label><label><b className="stepLabel">可稍后补充 · 计划</b>下节课计划<textarea value={closure.nextPlan} onChange={(event) => setClosureField("nextPlan", event.target.value)} /></label><div className="wide ratingGrid">{[["participation", "参与度"], ["understanding", "理解度"], ["completion", "完成度"], ["discipline", "课堂纪律"]].map(([key, label]) => <label key={key}>{label}<select value={closure[key as keyof typeof closure]} onChange={(event) => setClosureField(key as keyof typeof closure, event.target.value)}><option value="">待评</option>{[1, 2, 3, 4, 5].map((number) => <option key={number}>{number}</option>)}</select></label>)}</div></div><p className="privacyNote">完成前必须填写实际教学内容，并明确选择每名学生的出勤状态。作业、反馈和下节计划可转为待办；系统不会自动补写。</p><div className="modalActions"><Link className="secondaryButton" href={`/questions?lesson=${id}`}>关联课堂题目</Link><button className="secondaryButton" onClick={() => setFeedback({ ...feedback, content: `本节内容：${closure.actualContent || "待补充"}\n课堂表现：参与度${closure.participation || "待评"}，理解度${closure.understanding || "待评"}\n课后作业：${closure.homework || "待补充"}\n下节关注：${closure.nextPlan || "待补充"}` })}>带入反馈草稿</button><button disabled={busy || !dirty} className="secondaryButton" onClick={() => saveWorkflow("saveDraft")}>{busy ? "正在保存…" : "保存草稿"}</button><button disabled={busy} className="primaryButton" onClick={() => saveWorkflow("completeLesson")}>{busy ? "正在完成…" : "一键完成本节课"}</button></div></section>

      <section className="panel widePanel"><div className="panelTitle"><div><p>完成课时的核心记录</p><h2>学生出勤与课堂表现</h2></div><span>{activity.members.length} 名学生</span></div>{activity.members.length === 0 ? <EmptyState title="没有关联学生" description="本节课完成时只要求填写实际教学内容；如需学生学情，请先关联班级成员。" action={<Link className="secondaryButton" href="/classes">管理班级成员</Link>} /> : <div className="performanceList">{activity.members.map((member) => { const row = records[member.id] || {}; return <article key={member.id}><div className="studentName"><b>{member.name}</b><span>{member.grade}</span></div><label>出勤<select value={String(row.attendanceStatus || "")} onChange={(event) => setRecord(member.id, "attendanceStatus", event.target.value)}><option value="">请选择</option><option value="present">出勤</option><option value="late">迟到</option><option value="absent">缺勤</option><option value="leave">请假</option></select></label>{[["participation", "参与"], ["understanding", "理解"], ["completion", "完成"]].map(([key, label]) => <label key={key}>{label}<select value={String(row[key] || "")} onChange={(event) => setRecord(member.id, key, event.target.value)}><option value="">待评</option>{[1, 2, 3, 4, 5].map((number) => <option key={number}>{number}</option>)}</select></label>)}<label className="noteField">教师备注<input value={String(row.teacherNote || "")} onChange={(event) => setRecord(member.id, "teacherNote", event.target.value)} /></label><label>关注标签<select value={String(row.riskTags || "")} onChange={(event) => setRecord(member.id, "riskTags", event.target.value)}><option value="">无</option><option>缺勤</option><option>作业拖延</option><option>知识漏洞</option><option>情绪/沟通关注</option></select></label><label className="checkLabel"><input type="checkbox" checked={Boolean(row.riskConfirmed)} onChange={(event) => setRecord(member.id, "riskConfirmed", event.target.checked)} />教师确认关注</label><button onClick={() => post({ action: "studentRecord", studentId: member.id, ...row })}>单独保存</button></article>; })}</div>}</section>

      <section className="panel"><div className="panelTitle"><div><p>可随完成动作同步</p><h2>课后作业</h2></div><b>{activity.assignments.length}</b></div><div className="compactForm"><input value={assignment.title} onChange={(event) => setAssignment({ ...assignment, title: event.target.value })} placeholder="作业名称" /><textarea value={assignment.requirements} onChange={(event) => setAssignment({ ...assignment, requirements: event.target.value })} placeholder="完成要求" /><input type="date" value={assignment.dueAt} onChange={(event) => setAssignment({ ...assignment, dueAt: event.target.value })} /><button onClick={() => post({ action: "assignment", ...assignment })}>单独布置作业</button></div>{activity.assignments.map((item) => <p className="savedItem" key={String(item.id)}><b>{String(item.title)}</b><span>{String(item.due_at || "未设截止日期")}</span></p>)}</section>

      <section className="panel"><div className="panelTitle"><div><p>可随完成动作同步</p><h2>反馈草稿</h2></div><b>{activity.feedback.length}</b></div><div className="compactForm"><select value={feedback.studentId} onChange={(event) => setFeedback({ ...feedback, studentId: event.target.value })}><option value="">班级整体反馈</option>{activity.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select><select value={feedback.tone} onChange={(event) => setFeedback({ ...feedback, tone: event.target.value })}><option>专业简洁</option><option>温和鼓励</option><option>重点提醒</option></select><textarea value={feedback.content} onChange={(event) => setFeedback({ ...feedback, content: event.target.value })} placeholder="填写本节内容、亮点、待巩固知识点、作业与下节关注点" /><button onClick={() => post({ action: "feedback", ...feedback, classId: lesson.classId, type: "lesson" })}>单独保存反馈</button></div><div className="detailActions"><Link href={`/feedback?lesson=${id}`}>进入反馈中心编辑</Link><Link href={`/reflections?lesson=${id}`}>新建教学反思</Link></div></section>

      <section className="panel widePanel"><div className="panelTitle"><div><p>课堂题目</p><h2>已关联题目</h2></div><Link href={`/questions?lesson=${id}`} className="secondaryButton">＋ 从题库关联</Link></div>{activity.questions.length === 0 ? <EmptyState title="还没有关联题目" description="可从正式题库选择课堂练习、作业或测验题。" /> : <div className="linkedQuestions">{activity.questions.map((question, index) => <article key={String(question.id)}><b>{index + 1}</b><div><span>{String(question.questionType)} · 难度{String(question.difficulty)}</span><p>{String(question.stem)}</p></div><em>{String(question.purpose)}</em></article>)}</div>}</section>
    </div>
  </AppShell>;
}
