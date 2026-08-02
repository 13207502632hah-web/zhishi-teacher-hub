"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./portal.module.css";

type PortalRole = "student" | "parent";
type BindingStatus = "active" | "unbound" | "pending" | "disabled" | "expired";

type Student = { id: number; name: string; grade?: string; stageGoal?: string };
type Attachment = { id: number; name: string; mimeType?: string; size?: number; href: string; fileType: string };
type Assignment = {
  id: number;
  assignmentId: number;
  studentId: number;
  title: string;
  requirements?: string;
  dueAt?: string | null;
  status: string;
  score?: number | null;
  feedbackStatus: string;
  needsAction: boolean;
  attachments?: Attachment[];
};
type Feedback = { id: number; studentId?: number | null; type: string; content: string; feedbackStatus: string; confirmedAt?: string; sentAt?: string };
type Result = { id: number; studentId: number; title: string; date?: string; totalScore?: number; score?: number | null; weakKnowledge?: string };
type Resource = { id: number; title: string; type?: string; tags?: string; content?: string; href?: string | null };
type PortalData = {
  role: PortalRole;
  bindingStatus: BindingStatus;
  dataState: "ready" | "empty" | "unbound" | "pending" | "disabled" | "expired";
  sessionStatus: "active" | "expired";
  students: Student[];
  assignments: Assignment[];
  feedback: Feedback[];
  results: Result[];
  resources: Resource[];
};

const errorMessage = (reason: unknown, fallback: string) => reason instanceof HttpError ? reason.message : fallback;

const assignmentStatus = (status: string) => {
  if (status === "revision") return "需要订正";
  if (status === "revision_submitted") return "订正待批阅";
  if (status === "submitted") return "已提交，待批阅";
  if (status === "completed") return "已完成";
  if (status === "incomplete") return "需要补交";
  return "待完成";
};

const feedbackStatus = (status: string) => status === "needs_revision" ? "需要订正" : status === "awaiting_review" ? "订正待批阅" : status === "confirmed" ? "已确认" : "待教师处理";

const dueText = (value?: string | null) => {
  if (!value) return "未设置截止时间";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : `截止 ${value.replace("T", " ").slice(0, 16)}`;
};

function StateCard({ title, description, action, alert = false }: { title: string; description: string; action?: ReactNode; alert?: boolean }) {
  return <section className={`${styles.state} ${alert ? styles.stateAlert : ""}`} role={alert ? "alert" : "status"}>
    <span className={styles.stateIcon} aria-hidden="true">{alert ? "!" : "知"}</span>
    <h2 className={styles.stateTitle}>{title}</h2>
    <p className={styles.stateCopy}>{description}</p>
    {action && <div className={styles.stateAction}>{action}</div>}
  </section>;
}

export default function PortalPage() {
  const [data, setData] = useState<PortalData | null>(null);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [loading, setLoading] = useState(true);
  const [portalLoadError, setPortalLoadError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("mini_token") || "";
    if (!token) {
      setBootstrapReady(true);
      return () => controller.abort();
    }

    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const exchange = async () => {
      try {
        await requestJson<{ ok: boolean; returnTo: string }>("/api/portal/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
          timeoutMs: 15_000,
        });
        if (!controller.signal.aborted) window.location.reload();
      } catch (reason) {
        if (controller.signal.aborted) return;
        setExchangeError(errorMessage(reason, "暂时无法建立门户登录，请返回微信小程序后重试"));
        setBootstrapReady(true);
      }
    };
    void exchange();
    return () => controller.abort();
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setData(null);
    setPortalLoadError("");
    setSessionExpired(false);
    setForbidden(false);
    try {
      const payload = await requestJson<PortalData>("/api/portal", { signal, timeoutMs: 15_000 });
      if (!payload) throw new HttpError(200, "门户响应为空，请重试");
      setData(payload);
      setSelectedStudentId((current) => payload.role === "parent" && payload.students.some((student) => student.id === current) ? current : payload.students[0]?.id || null);
    } catch (reason) {
      if (signal?.aborted) return;
      if (reason instanceof HttpError && reason.status === 401) setSessionExpired(true);
      else if (reason instanceof HttpError && reason.status === 403) setForbidden(true);
      else setPortalLoadError(errorMessage(reason, "暂时无法读取门户内容，请稍后重试"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bootstrapReady || exchangeError) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [bootstrapReady, exchangeError, load, reloadKey]);

  const retry = <button type="button" className={styles.stateActionButton} onClick={() => setReloadKey((value) => value + 1)}>重新读取门户</button>;
  if (!bootstrapReady) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="正在建立安全登录" description="正在核验微信小程序会话；登录凭据不会保存在网页中。" /></AppShell>;
  if (exchangeError) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="暂时无法建立门户登录" description={exchangeError} alert /></AppShell>;
  if (sessionExpired) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="请从微信小程序进入" description="当前网页没有有效的学生或家长会话。请在微信小程序“课程、反馈与学情”中点击“打开网页版”；旧数据不会显示。" action={retry} alert /></AppShell>;
  if (forbidden) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="当前账号暂不能进入门户" description="只有已获门户权限的学生或家长账号可以查看关联内容；教师内部资料不会在这里展示。" action={retry} alert /></AppShell>;
  if (portalLoadError) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="门户暂时没有完整读取" description={portalLoadError} action={retry} alert /></AppShell>;
  if (loading || !data) return <AppShell title="我的学习" subtitle="学生与家长移动门户"><StateCard title="正在读取已授权内容" description="只会读取当前账号已获授权的学生和教师确认内容。" /></AppShell>;

  const viewer = data.role === "parent" ? {
    label: "家长视角",
    eyebrow: "陪伴孩子完成今天的学习",
    description: "只显示已绑定孩子、教师确认并允许发送的内容。",
  } : {
    label: "学生视角",
    eyebrow: "把今天最重要的一件事先完成",
    description: "只显示你自己的作业、确认反馈、成绩和指定文件。",
  };
  const bindingState = data.bindingStatus;
  if (bindingState === "unbound") return <AppShell title="我的学习" subtitle={viewer.label}><StateCard title="账号尚未绑定学生" description="当前账号没有已确认的学生关联；绑定确认前不会展示学生姓名、作业或反馈。" /></AppShell>;
  if (bindingState === "pending") return <AppShell title="我的学习" subtitle={viewer.label}><StateCard title="绑定申请待教师确认" description="申请已经提交，教师确认后才会开放对应学生内容。现在不会展示未确认资料。" /></AppShell>;
  if (bindingState === "disabled") return <AppShell title="我的学习" subtitle={viewer.label}><StateCard title="绑定已停用" description="这条学生关联已被停用，旧会话也不能继续读取学生数据。请联系教师重新确认绑定。" /></AppShell>;
  if (bindingState === "expired") return <AppShell title="我的学习" subtitle={viewer.label}><StateCard title="绑定会话已过期" description="请重新登录并等待教师确认有效绑定。为了安全，页面没有保留旧数据。" action={retry} alert /></AppShell>;

  const activeStudentId = data.role === "parent" ? selectedStudentId || data.students[0]?.id : data.students[0]?.id;
  const activeStudent = data.students.find((student) => student.id === activeStudentId) || data.students[0];
  const visibleAssignments = data.assignments.filter((item) => !activeStudentId || item.studentId === activeStudentId);
  const visibleFeedback = data.feedback.filter((item) => !item.studentId || !activeStudentId || item.studentId === activeStudentId);
  const visibleResults = data.results.filter((item) => !activeStudentId || item.studentId === activeStudentId);
  const actionable = visibleAssignments.filter((item) => item.needsAction || item.status === "revision");
  const nextAction = actionable[0];
  const studentName = (studentId: number) => data.students.find((student) => student.id === studentId)?.name || "当前学生";
  const counts = { assignments: visibleAssignments.length, todo: actionable.length, feedback: visibleFeedback.length, results: visibleResults.length };

  return <AppShell title="我的学习" subtitle={`${viewer.label} · 只读门户`}>
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{viewer.eyebrow}</p>
          <h2 className={styles.heroTitle}>{viewer.label}{activeStudent ? ` · ${activeStudent.name}` : ""}</h2>
          <p className={styles.heroCopy}>{viewer.description}</p>
        </div>
        <p className={styles.privacyNote}>资料由服务端按当前账号授权范围返回；页面不显示监护人联系方式、教师内部备注或未确认评价。</p>
      </header>

      {data.role === "parent" && data.students.length > 1 && <section className={styles.switcher} aria-label="选择已绑定孩子">
        <label className={styles.switcherLabel}>查看孩子
          <select className={styles.select} value={activeStudentId || ""} onChange={(event) => setSelectedStudentId(Number(event.target.value))}>
            {data.students.map((student) => <option value={student.id} key={student.id}>{student.name}{student.grade ? ` · ${student.grade}` : ""}</option>)}
          </select>
        </label>
      </section>}

      <section className={styles.priority} aria-labelledby="portal-priority-title">
        <div className={styles.priorityHeader}><p className={styles.eyebrow}>今天先看这里</p><h2 id="portal-priority-title" className={styles.priorityTitle}>现在要做什么</h2></div>
        {nextAction ? <div className={styles.priorityBody}><div><strong>{nextAction.status === "revision" ? "先完成订正" : "先完成这份作业"}</strong><p>{nextAction.title} · {dueText(nextAction.dueAt)}</p></div><a className={styles.priorityLink} href="#assignments">查看作业</a></div> : <div className={styles.priorityBody}><div><strong>今天没有待处理订正</strong><p>{dataStateText(data.dataState, counts.feedback ? "可以先阅读最新的教师确认反馈。" : "教师发布并确认内容后会显示在这里。")}</p></div><a className={styles.priorityLink} href="#feedback">查看反馈</a></div>}
      </section>

      {data.dataState === "empty" && <section className={styles.empty} role="status"><h2 className={styles.emptyTitle}>目前还没有可显示内容</h2><p className={styles.emptyCopy}>绑定已生效，但教师尚未发布作业、确认反馈或指定资料。这里不会生成虚构数据。</p></section>}

      <div className={styles.metrics} aria-label="学习内容概览">
        <article><span>待处理</span><strong>{counts.todo}</strong><small>作业或订正</small></article>
        <article><span>作业</span><strong>{counts.assignments}</strong><small>当前孩子</small></article>
        <article><span>确认反馈</span><strong>{counts.feedback}</strong><small>教师已确认</small></article>
        {data.role === "student" && <article><span>成绩</span><strong>{counts.results}</strong><small>已完成测验</small></article>}
      </div>

      <div className={styles.contentGrid}>
        <section id="assignments" className={styles.panel} aria-labelledby="assignments-title">
          <div className={styles.panelHeader}><div><p className={styles.panelEyebrow}>学习任务</p><h2 id="assignments-title" className={styles.panelTitle}>作业与订正</h2></div><span className={styles.panelCount}>{visibleAssignments.length} 项</span></div>
          {visibleAssignments.length === 0 ? <p className={styles.emptyCopy}>暂无已发布作业。</p> : <div className={styles.list}>{visibleAssignments.map((item) => <article className={`${styles.assignment} ${item.needsAction ? styles.assignmentPriority : ""}`} key={item.id}>
            <div className={styles.assignmentHeader}><div><h3 className={styles.assignmentTitle}>{item.title}</h3>{data.role === "parent" && <p className={styles.metaText}>{studentName(item.studentId)}</p>}</div><span className={`${styles.badge} ${item.needsAction ? styles.badgeWarning : styles.badgeSuccess}`}>{assignmentStatus(item.status)}</span></div>
            <div className={styles.assignmentMeta}><span>{dueText(item.dueAt)}</span><span>反馈：{feedbackStatus(item.feedbackStatus)}</span>{item.score != null && <span>成绩 {item.score}</span>}</div>
            {item.requirements && <p className={styles.bodyText}>{item.requirements}</p>}
            {item.status === "revision" && <p className={styles.revision}>教师已确认需要订正，请完成后再提交。</p>}
            {item.attachments?.length ? <div className={styles.attachments}><strong>指定文件</strong><div className={styles.attachmentList}>{item.attachments.map((attachment) => <a className={styles.attachmentLink} href={attachment.href} key={`${attachment.fileType}-${attachment.id}`}>{attachment.name}</a>)}</div></div> : null}
          </article>)}</div>}
        </section>

        <section id="feedback" className={styles.panel} aria-labelledby="feedback-title">
          <div className={styles.panelHeader}><div><p className={styles.panelEyebrow}>教师确认</p><h2 id="feedback-title" className={styles.panelTitle}>反馈</h2></div><span className={styles.panelCount}>{visibleFeedback.length} 条</span></div>
          {visibleFeedback.length === 0 ? <p className={styles.emptyCopy}>暂无已确认且允许发送的反馈。</p> : <div className={styles.list}>{visibleFeedback.map((item) => <article className={styles.feedback} key={item.id}><div className={styles.feedbackHeader}><span className={styles.feedbackType}>{item.type === "stage" ? "阶段反馈" : "单节课反馈"}</span><span className={styles.badgeSuccess}>已确认 · 已允许发送</span><time className={styles.time}>{item.confirmedAt?.slice(0, 10)}</time></div><pre className={styles.bodyText}>{item.content}</pre></article>)}</div>}
        </section>

        {data.role === "student" && <section className={styles.panel} aria-labelledby="results-title"><div className={styles.panelHeader}><div><p className={styles.panelEyebrow}>已完成测验</p><h2 id="results-title" className={styles.panelTitle}>成绩</h2></div><span className={styles.panelCount}>{visibleResults.length} 条</span></div>{visibleResults.length === 0 ? <p className={styles.emptyCopy}>暂无已确认成绩。</p> : <div className={styles.resultGrid}>{visibleResults.map((item) => <article className={styles.result} key={item.id}><span className={styles.metaText}>{item.date || "日期待补"}</span><h3>{item.title}</h3><strong>{item.score == null ? "—" : item.score}<small> / {item.totalScore ?? "—"}</small></strong>{item.weakKnowledge && <p className={styles.bodyText}>待巩固：{item.weakKnowledge}</p>}</article>)}</div>}</section>}

        <section className={styles.panel} aria-labelledby="resources-title"><div className={styles.panelHeader}><div><p className={styles.panelEyebrow}>教师指定</p><h2 id="resources-title" className={styles.panelTitle}>学习资料</h2></div><span className={styles.panelCount}>{data.resources.length} 项</span></div>{data.resources.length === 0 ? <p className={styles.emptyCopy}>暂无教师指定资料。</p> : <div className={styles.list}>{data.resources.map((resource) => <article className={styles.resource} key={resource.id}><div className={styles.resourceHeader}><h3>{resource.title}</h3>{resource.type && <span className={styles.metaText}>{resource.type}</span>}</div>{resource.content && <p className={styles.bodyText}>{resource.content}</p>}{resource.tags && <p className={styles.metaText}>标签：{resource.tags}</p>}{resource.href && <a className={styles.attachmentLink} href={resource.href} rel="noreferrer">打开公开资料</a>}</article>)}</div>}</section>
      </div>
    </div>
  </AppShell>;
}

function dataStateText(state: PortalData["dataState"], fallback: string) {
  if (state === "empty") return fallback;
  if (state === "unbound") return "账号尚未绑定学生。";
  if (state === "pending") return "绑定申请待教师确认。";
  if (state === "disabled") return "绑定已停用。";
  if (state === "expired") return "登录状态已过期。";
  return fallback;
}
