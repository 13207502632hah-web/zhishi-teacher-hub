"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- native API links intentionally trigger CSV downloads. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import { aiBoolean } from "../lib/ai/settings";
import styles from "./settings.module.css";

const DELETE_CONFIRMATION = "删除全部教学数据";
const DEMO_CONFIRMATION = "清除演示数据";

type LoadState = "loading" | "ready" | "error";
type BusyState = Record<string, boolean>;

type AccountForm = { name: string; email: string; role: string; studentId: string };
type User = { id: number; name: string; email?: string; status?: string; roles?: string; roleNames?: string };
type Student = { id: number; name: string; grade?: string };
type ClassItem = { id: number; name: string; stage?: string; grade?: string };
type SettingsData = {
  current?: { id: number; accountLabel?: string; roleName?: string };
  users?: User[];
  students?: Student[];
  classes?: ClassItem[];
  staffClassAccess?: Array<{ userId: number; classId: number }>;
  logs?: Array<{ id: number; action?: string; entityType?: string; entityId?: string | number; createdAt?: string; userName?: string }>;
};
type AiSettings = {
  enabled?: unknown;
  includeStudentName?: unknown;
  privacyAckAt?: string | null;
  dailyLimit?: number | null;
  emergencyDisabled?: unknown;
  fastModel?: string;
  deepModel?: string;
};
type AiData = {
  settings?: AiSettings | null;
  serverConfigured?: boolean;
  usage?: { calls?: number; tokens?: number; estimatedCostUsd?: number };
  usageDetail?: { today?: { calls?: number; tokens?: number }; recentFailures?: Array<{ id: number; createdAt?: string; feature?: string; errorCode?: string; errorMessage?: string }> };
  learning?: { count?: number; activeCount?: number };
  learningRecords?: Array<{ id: number; stage?: string; grade?: string; audience?: string; tone?: string; active?: unknown; createdAt?: string }>;
};
type DemoData = { runs?: Array<{ runId?: string; count?: number; createdAt?: string }> };
type ApiResult = { ok?: boolean; message?: string; mode?: string; summary?: Record<string, number>; settings?: AiSettings | null };

const blankAccount: AccountForm = { name: "", email: "", role: "assistant", studentId: "" };
const blankPassword = { currentPassword: "", newPassword: "", confirmPassword: "" };
const actionLabels: Record<string, string> = {
  create: "创建", update: "修改", save: "保存", delete: "删除", export: "导出", assign_role: "分配角色",
  assign_class_scope: "分配班级", disable: "停用", delete_all: "清空数据", seed_demo: "创建演示数据",
  clear_demo: "清除演示数据", change_password: "修改管理员密码", enable: "启用",
};
const aiFeatureLabels: Record<string, string> = {
  feedback_draft: "反馈草稿", question_review: "题库审核", lesson_prep: "备课草案", paper_review: "试卷质检",
  reflection_draft: "反思草案", wrong_question_remediation: "分层订正", schedule_reschedule: "调课建议",
};

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function required<T>(value: T | null, message: string) {
  if (value === null) throw new HttpError(200, message);
  return value;
}

function StateBox({ kind, title, description, action }: { kind: "loading" | "error" | "empty"; title: string; description: string; action?: ReactNode }) {
  return <div className={`${styles.stateBox} ${styles[`state${kind[0].toUpperCase()}${kind.slice(1)}`]}`} role={kind === "error" ? "alert" : "status"} aria-live="polite" aria-busy={kind === "loading"}>
    <strong>{title}</strong><p>{description}</p>{action}
  </div>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className={styles.secondaryButton} onClick={onClick}>重试</button>;
}

function SectionHeader({ eyebrow, title, id, description }: { eyebrow: string; title: string; id: string; description?: string }) {
  return <header className={styles.sectionHeader}><div><p className={styles.eyebrow}>{eyebrow}</p><h2 id={id}>{title}</h2></div>{description && <p className={styles.sectionDescription}>{description}</p>}</header>;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [settingsState, setSettingsState] = useState<LoadState>("loading");
  const [settingsError, setSettingsError] = useState("");
  const [ai, setAi] = useState<AiData | null>(null);
  const [aiDraft, setAiDraft] = useState<AiSettings | null>(null);
  const [aiState, setAiState] = useState<LoadState>("loading");
  const [aiError, setAiError] = useState("");
  const [demoRuns, setDemoRuns] = useState<DemoData["runs"]>([]);
  const [demoState, setDemoState] = useState<LoadState>("loading");
  const [demoError, setDemoError] = useState("");
  const [form, setForm] = useState<AccountForm>({ ...blankAccount });
  const [assistantId, setAssistantId] = useState("");
  const [classIds, setClassIds] = useState<number[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [demoConfirmation, setDemoConfirmation] = useState("");
  const [passwordForm, setPasswordForm] = useState({ ...blankPassword });
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [aiDraftDirty, setAiDraftDirty] = useState(false);
  const [scopeDirty, setScopeDirty] = useState(false);
  const [dangerModal, setDangerModal] = useState<"delete" | "demo" | null>(null);
  const [logLimit, setLogLimit] = useState(30);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<BusyState>({});
  const busyRef = useRef<BusyState>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const loadSettings = useCallback(async () => {
    setSettingsState("loading");
    setSettingsError("");
    try {
      const next = required(await requestJson<SettingsData>("/api/settings", { cache: "no-store" }), "设置接口没有返回数据");
      setData(next);
      setSettingsState("ready");
    } catch (reason) {
      setSettingsError(errorMessage(reason, "读取账号与权限失败"));
      setSettingsState("error");
    }
  }, []);

  const loadAi = useCallback(async () => {
    setAiState("loading");
    setAiError("");
    try {
      const next = required(await requestJson<AiData>("/api/settings/ai", { cache: "no-store" }), "AI 设置接口没有返回数据");
      setAi(next);
      setAiDraft(next.settings ?? null);
      setAiDraftDirty(false);
      setAiState("ready");
    } catch (reason) {
      setAiError(errorMessage(reason, "读取 AI 设置失败"));
      setAiState("error");
    }
  }, []);

  const loadDemo = useCallback(async () => {
    setDemoState("loading");
    setDemoError("");
    try {
      const next = required(await requestJson<DemoData>("/api/settings/demo", { cache: "no-store" }), "演示数据接口没有返回数据");
      setDemoRuns(Array.isArray(next.runs) ? next.runs : []);
      setDemoState("ready");
    } catch (reason) {
      setDemoError(errorMessage(reason, "读取演示数据状态失败"));
      setDemoState("error");
    }
  }, []);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSettings(), loadAi(), loadDemo()]);
  }, [loadAi, loadDemo, loadSettings]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const runExclusive = useCallback(async (key: string, task: () => Promise<void>, fallback: string) => {
    if (busyRef.current[key]) return false;
    busyRef.current[key] = true;
    setBusy((current) => ({ ...current, [key]: true }));
    try {
      await task();
      return true;
    } catch (reason) {
      setMessage(errorMessage(reason, fallback));
      return false;
    } finally {
      busyRef.current[key] = false;
      setBusy((current) => ({ ...current, [key]: false }));
    }
  }, []);

  const users = data?.users ?? [];
  const students = data?.students ?? [];
  const classes = data?.classes ?? [];
  const logs = data?.logs ?? [];
  const assistants = users.filter((user) => user.status === "active" && (String(user.roles ?? "").split(",").includes("assistant") || String(user.roleNames ?? "").includes("助教")));
  const memberUsers = users.filter((user) => user.email !== "teacher-admin@local.invalid");
  const currentAiSettings = aiDraft ?? ai?.settings ?? null;
  const accountFormDirty = Boolean(form.name.trim() || form.email.trim() || form.studentId || form.role !== blankAccount.role);
  const passwordFormDirty = Boolean(passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword);
  const hasUnsavedChanges = accountFormDirty || passwordFormDirty || privacyAcknowledged || aiDraftDirty || scopeDirty;

  const updateAiDraft = (patch: Partial<AiSettings>) => {
    setAiDraft((current) => current ? { ...current, ...patch } : current);
    setAiDraftDirty(true);
  };

  const chooseAssistant = (id: string) => {
    if (scopeDirty && !window.confirm("当前助教授权有未保存更改，切换后将丢失。继续吗？")) return;
    setAssistantId(id);
    setScopeDirty(false);
    setClassIds((data?.staffClassAccess ?? []).filter((item) => String(item.userId) === id).map((item) => Number(item.classId)));
  };

  const toggleClass = (id: number) => {
    setScopeDirty(true);
    setClassIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const saveUser = async () => {
    await runExclusive("saveUser", async () => {
      required(await requestJson<ApiResult>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsertUser", ...form }),
      }), "账号接口没有返回结果");
      setForm({ ...blankAccount });
      setMessage("账号与权限已保存");
      await loadSettings();
    }, "保存账号权限失败");
  };

  const disableUser = async (userId: number) => {
    if (!window.confirm("确认停用这个账号？该账号将无法继续进入工作区。")) return;
    await runExclusive(`disableUser:${userId}`, async () => {
      await required(await requestJson<ApiResult>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disableUser", userId }),
      }), "停用接口没有返回结果");
      setMessage("账号已停用");
      await loadSettings();
    }, "停用账号失败");
  };

  const saveClassAccess = async () => {
    if (!assistantId) {
      setMessage("请先选择助教账号");
      return;
    }
    await runExclusive("setClassAccess", async () => {
      await required(await requestJson<ApiResult>("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setClassAccess", userId: Number(assistantId), classIds }),
      }), "授权接口没有返回结果");
      setScopeDirty(false);
      setMessage("助教班级授权已保存");
      await loadSettings();
    }, "保存助教授权失败");
  };

  const changePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    await runExclusive("changePassword", async () => {
      const result = required(await requestJson<ApiResult>("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      }), "密码接口没有返回结果");
      setPasswordForm({ ...blankPassword });
      setMessage(result.message ?? "密码已更新；其他设备上的旧会话已失效");
    }, "密码修改失败");
  };

  const saveAi = async (patch: Record<string, unknown> = {}) => {
    const current = currentAiSettings;
    if (!current) {
      setMessage("AI 设置尚未加载，请重试");
      return;
    }
    const payload: Record<string, unknown> = { ...patch };
    for (const key of ["enabled", "includeStudentName", "dailyLimit", "emergencyDisabled"] as const) {
      if (!(key in payload) && current[key] !== undefined) payload[key] = current[key];
    }
    if (privacyAcknowledged) payload.privacyAcknowledged = true;
    await runExclusive("saveAi", async () => {
      const result = required(await requestJson<AiData>("/api/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }), "AI 设置接口没有返回结果");
      setAi(result);
      setAiDraft(result.settings ?? null);
      setAiDraftDirty(false);
      setPrivacyAcknowledged(false);
      setMessage("AI 辅助设置已保存");
    }, "AI 设置保存失败");
  };

  const clearLearning = async () => {
    if (!window.confirm("确认清空已匿名化的反馈写作学习样本？此操作不会删除反馈原文。")) return;
    await runExclusive("clearLearning", async () => {
      const result = required(await requestJson<AiData>("/api/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearLearning" }),
      }), "AI 学习数据接口没有返回结果");
      setAi(result);
      setAiDraft(result.settings ?? null);
      setMessage("AI 写作学习样本已清空");
    }, "清空 AI 学习数据失败");
  };

  const setLearningActive = async (id: number, active: boolean) => {
    await runExclusive(`setLearningActive:${id}`, async () => {
      const result = required(await requestJson<AiData>("/api/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setLearningActive", id, active }),
      }), "AI 学习记录接口没有返回结果");
      setAi(result);
      setAiDraft(result.settings ?? null);
      setMessage(active ? "该学习记录已重新启用" : "该学习记录已停用，后续生成不再引用");
    }, "更新 AI 学习记录失败");
  };

  const exportData = async () => {
    if (!window.confirm("确认导出全部教学数据？文件可能包含学生姓名、评价与监护人联系方式，请妥善保管。")) return;
    await runExclusive("exportData", async () => {
      const payload = required(await requestJson<Record<string, unknown>>("/api/settings/export", { cache: "no-store" }), "导出接口没有返回数据");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `知师研室数据备份-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setMessage("数据已导出，并记录在操作日志中");
      await loadSettings();
    }, "导出失败，未生成下载文件");
  };

  const deleteData = async () => {
    if (confirmation !== DELETE_CONFIRMATION) {
      setMessage(`请输入“${DELETE_CONFIRMATION}”后再继续`);
      return;
    }
    if (!window.confirm("此操作不可恢复，账号与操作日志会保留。确认永久删除全部教学数据吗？")) return;
    await runExclusive("deleteData", async () => {
      await required(await requestJson<ApiResult>("/api/settings/data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      }), "删除接口没有返回结果");
      setConfirmation("");
      closeDangerModal(true);
      setMessage("全部教学数据已删除，账号与操作日志保留");
      await loadSettings();
      await loadDemo();
    }, "删除失败，未执行危险操作");
  };

  const seedDemo = async () => {
    if (!window.confirm("确认创建或补齐综合演示数据？系统只处理带“【演示】”标记的记录，不会替代真实数据；重复执行不会重复堆积。")) return;
    await runExclusive("seedDemo", async () => {
      const result = required(await requestJson<ApiResult>("/api/settings/demo", { method: "POST" }), "演示数据接口没有返回结果");
      const summary = result.summary ?? {};
      setMessage(`综合演示工作区已${result.mode === "verified" ? "核验" : "补齐"}：${summary.classes ?? 0} 个班级、${summary.students ?? 0} 名学生、${summary.lessons ?? 0} 节课、${summary.assignments ?? 0} 份作业`);
      await Promise.all([loadSettings(), loadDemo()]);
    }, "创建或补齐演示数据失败");
  };

  const clearDemo = async () => {
    if (demoConfirmation !== DEMO_CONFIRMATION) {
      setMessage(`请输入“${DEMO_CONFIRMATION}”后再继续`);
      return;
    }
    if (!window.confirm("仅清除带“【演示】”标记并由演示记录追踪的数据，真实教学记录不会受影响。继续吗？")) return;
    await runExclusive("clearDemo", async () => {
      await required(await requestJson<ApiResult>("/api/settings/demo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: demoConfirmation }),
      }), "演示清理接口没有返回结果");
      setDemoConfirmation("");
      closeDangerModal(true);
      setMessage("演示数据已清除，真实教学数据不受影响");
      await Promise.all([loadSettings(), loadDemo()]);
    }, "清除演示数据失败");
  };

  const closeDangerModal = useCallback((force = false) => {
    if (!force && hasUnsavedChanges && !window.confirm("当前页面有未保存更改，关闭弹窗后仍会保留。确认关闭吗？")) return;
    setDangerModal(null);
    setConfirmation("");
    setDemoConfirmation("");
  }, [hasUnsavedChanges]);

  const openDangerModal = (kind: "delete" | "demo", target: HTMLElement) => {
    restoreFocusRef.current = target;
    setDangerModal(kind);
  };

  useEffect(() => {
    if (!dangerModal) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled"));
    const first = focusables()[0];
    (first ?? dialog).focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDangerModal();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [closeDangerModal, dangerModal]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  if (!data && settingsState === "loading") return <AppShell title="设置" subtitle="账号权限与安全数据管理"><main className={styles.page}><StateBox kind="loading" title="正在读取设置" description="正在确认账号权限、AI 状态和演示数据范围…" /></main></AppShell>;
  if (!data && settingsState === "error") return <AppShell title="设置" subtitle="账号权限与安全数据管理"><main className={styles.page}><StateBox kind="error" title="设置暂时无法读取" description={settingsError || "请检查登录状态或网络连接后重试。"} action={<RetryButton onClick={() => void loadAll()} />} /></main></AppShell>;

  const visibleLogs = logs.slice(0, logLimit);
  return <AppShell title="设置" subtitle="账号权限、安全保护、AI 辅助与数据管理">
    <div className={styles.page}>
      {message && <div className={styles.toast} role="status" aria-live="polite">{message}</div>}
      {settingsState === "loading" && <StateBox kind="loading" title="正在刷新账号与权限" description="现有内容仍保留，刷新完成后会更新权限结果。" />}
      {settingsState === "error" && <StateBox kind="error" title="账号与权限刷新失败" description={settingsError} action={<RetryButton onClick={() => void loadSettings()} />} />}
      <section className={styles.banner} aria-label="当前身份">
        <div><strong>当前身份：教师管理员</strong><span>管理员账号 {data?.current?.accountLabel ?? "已配置"} · {data?.current?.roleName ?? "教师"}</span></div>
        <p>设置页默认只显示常用、低风险配置；导出、清空和删除均需再次确认并写入操作日志。</p>
      </section>

      <section className={styles.section} aria-labelledby="account-heading">
        <SectionHeader eyebrow="常用设置" title="账号与权限" id="account-heading" description="为成员分配最小必要角色；停用后不能继续进入工作区。" />
        <div className={styles.roleGrid}>
          <p><strong>教师</strong>全权限、导出与危险操作</p><p><strong>助教</strong>仅能访问明确授权的班级</p><p><strong>学生</strong>只能查看本人关联的学习内容</p><p><strong>家长</strong>只能查看已确认的孩子内容</p>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.field}><span>成员姓名</span><input className={styles.input} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className={styles.field}><span>成员邮箱</span><input className={styles.input} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className={styles.field}><span>角色</span><select className={styles.input} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value, studentId: "" })}><option value="assistant">助教</option><option value="teacher">教师</option><option value="student">学生</option><option value="parent">家长</option></select></label>
          {form.role !== "assistant" && <label className={styles.field}><span>关联学生（可选）</span><select className={styles.input} value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}><option value="">不关联</option>{students.map((student) => <option value={student.id} key={student.id}>{student.name} · {student.grade ?? "年级未填"}</option>)}</select></label>}
          <button type="button" className={styles.primaryButton} disabled={Boolean(busy.saveUser)} onClick={() => void saveUser()}>{busy.saveUser ? "保存中…" : "保存账号权限"}</button>
        </div>
        {memberUsers.length === 0 ? <StateBox kind="empty" title="暂无成员账号" description="保存第一位成员后，账号与角色会显示在这里。" /> : <div className={styles.accountList}>{memberUsers.map((user) => <article className={styles.accountRow} key={user.id}><div><strong>{user.name}</strong><span>{user.email ?? "未填写邮箱"}</span></div><span className={styles.badge}>{user.roleNames || "未分配角色"}</span><span className={styles.badge}>{user.status === "active" ? "启用" : "已停用"}</span>{user.id !== data?.current?.id && user.status === "active" && <button type="button" className={styles.textButton} disabled={Boolean(busy[`disableUser:${user.id}`])} onClick={() => void disableUser(user.id)}>{busy[`disableUser:${user.id}`] ? "停用中…" : "停用"}</button>}</article>)}</div>}
      </section>

      <section className={styles.section} aria-labelledby="scope-heading">
        <SectionHeader eyebrow="服务端复核" title="助教班级授权" id="scope-heading" description="未明确授权的班级不会出现在助教可访问范围内；保存时服务端会再次校验账号和班级状态。" />
        {assistants.length === 0 ? <StateBox kind="empty" title="暂无启用的助教账号" description="先在账号与权限中保存并启用助教账号。" /> : <div className={styles.scopeLayout}>
          <label className={styles.field}><span>选择助教</span><select className={styles.input} value={assistantId} onChange={(event) => chooseAssistant(event.target.value)}><option value="">请选择助教</option>{assistants.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></label>
          {assistantId ? <div className={styles.checkList}>{classes.length === 0 ? <StateBox kind="empty" title="暂无可授权班级" description="只有启用中的班级可以被授权。" /> : classes.map((item) => <label className={styles.checkRow} key={item.id}><input type="checkbox" checked={classIds.includes(Number(item.id))} onChange={() => toggleClass(Number(item.id))} /> <span>{item.name} · {item.stage}{item.grade}</span></label>)}</div> : <p className={styles.helper}>选择助教后，只展示启用中的班级。没有勾选的班级不会被授权。</p>}
          <button type="button" className={styles.secondaryButton} disabled={!assistantId || Boolean(busy.setClassAccess)} onClick={() => void saveClassAccess()}>{busy.setClassAccess ? "授权保存中…" : "保存班级授权"}</button>
        </div>}
      </section>

      <section className={styles.section} aria-labelledby="password-heading">
        <SectionHeader eyebrow="登录安全" title="密码安全" id="password-heading" description="修改教师管理员密码时，密码只提交给认证接口；成功后本页立即清空输入，不保存或回显密码。" />
        <p className={styles.helper}>新密码至少 12 位，并同时包含字母和数字。修改后，其他设备上的旧会话会失效；当前设备会收到新的会话 Cookie。</p>
        <div className={styles.formGrid}>
          <label className={styles.field}><span>当前密码</span><input className={styles.input} type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
          <label className={styles.field}><span>新密码</span><input className={styles.input} type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
          <label className={styles.field}><span>确认新密码</span><input className={styles.input} type="password" autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
          <button type="button" className={styles.primaryButton} disabled={Boolean(busy.changePassword) || !passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword} onClick={() => void changePassword()}>{busy.changePassword ? "修改中…" : "修改密码"}</button>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ai-heading">
        <SectionHeader eyebrow="教师专属 · 服务端调用" title="AI辅助设置" id="ai-heading" description="只生成草稿和审核建议，不自动发布、不改变正式题目状态；密钥永不进入浏览器。" />
        {aiState === "loading" && !ai && <StateBox kind="loading" title="正在读取 AI 设置" description="正在确认开关、隐私确认、每日限额和紧急停用状态…" />}
        {aiState === "error" && <StateBox kind="error" title="AI 设置读取失败" description={aiError} action={<RetryButton onClick={() => void loadAi()} />} />}
        {ai && currentAiSettings && <>
          <div className={styles.statusLine}><span className={ai?.serverConfigured ? styles.successBadge : styles.warningBadge}>{ai?.serverConfigured ? "服务器已配置" : "等待安全配置"}</span><span>当前仅教师管理员可使用；联系方式、微信标识、附件与登录数据不会发送。</span></div>
          <div className={styles.metricGrid}><article><strong>{Number(ai.usage?.calls ?? 0)}</strong><span>本月调用</span></article><article><strong>{Number(ai.usage?.tokens ?? 0).toLocaleString()}</strong><span>本月 Token</span></article><article><strong>${Number(ai.usage?.estimatedCostUsd ?? 0).toFixed(4)}</strong><span>费用估算</span></article><article><strong>{Number(ai.learning?.activeCount ?? 0)}</strong><span>启用学习样本</span></article></div>
          <div className={styles.aiNotes}><p><strong>快速模型</strong>{currentAiSettings.fastModel ?? "deepseek-v4-flash"} · 反馈关闭思考、批量题库开启思考</p><p><strong>深度模型</strong>{currentAiSettings.deepModel ?? "deepseek-v4-pro"} · 仅教师手动单题复核</p><p><strong>今日用量</strong>{Number(ai.usageDetail?.today?.calls ?? 0)} 次 / {Number(currentAiSettings.dailyLimit ?? 0)} 次，{Number(ai.usageDetail?.today?.tokens ?? 0).toLocaleString()} Token</p></div>
          <div className={styles.formGrid}>
            <label className={styles.checkRow}><input type="checkbox" checked={aiBoolean(currentAiSettings.enabled)} onChange={(event) => updateAiDraft({ enabled: event.target.checked })} /> <span>启用 AI 辅助总开关</span></label>
            <label className={styles.checkRow}><input type="checkbox" checked={aiBoolean(currentAiSettings.includeStudentName)} onChange={(event) => updateAiDraft({ includeStudentName: event.target.checked })} /> <span>反馈草稿可传学生姓名（关闭后替换为“【学生】”）</span></label>
            <label className={styles.field}><span>每日调用上限</span><input className={styles.input} type="number" min="1" max="200" value={currentAiSettings.dailyLimit ?? ""} onChange={(event) => updateAiDraft({ dailyLimit: Number(event.target.value) })} /></label>
            {!currentAiSettings.privacyAckAt && <label className={`${styles.checkRow} ${styles.privacyRow}`}><input type="checkbox" checked={privacyAcknowledged} onChange={(event) => setPrivacyAcknowledged(event.target.checked)} /> <span>我已知晓：课堂记录和题目内容会发送给 DeepSeek；每次生成会列出发送字段，联系方式、微信标识、附件与登录数据永不发送，最终内容由教师核对。</span></label>}
            <button type="button" className={styles.primaryButton} disabled={Boolean(busy.saveAi) || (!currentAiSettings.privacyAckAt && !privacyAcknowledged)} onClick={() => void saveAi()}>{busy.saveAi ? "保存中…" : "保存 AI 设置"}</button>
            {aiBoolean(currentAiSettings.emergencyDisabled) ? <button type="button" className={styles.secondaryButton} disabled={Boolean(busy.saveAi)} onClick={() => void saveAi({ emergencyDisabled: false })}>解除紧急停用（总开关仍需另行确认）</button> : <button type="button" className={styles.dangerButton} disabled={Boolean(busy.saveAi)} onClick={() => void saveAi({ enabled: false, emergencyDisabled: true })}>紧急停用</button>}
            <button type="button" className={styles.textButton} disabled={Boolean(busy.clearLearning) || !Number(ai.learning?.count ?? 0)} onClick={() => void clearLearning()}>{busy.clearLearning ? "清空中…" : "清空全部个性化写作样本"}</button>
          </div>
          <div className={styles.subsection}><h3>个性化学习记录</h3><p className={styles.helper}>只记录脱敏后的版本差异；停用后，后续生成不再引用该条。</p>{ai.learningRecords?.length ? <div className={styles.accountList}>{ai.learningRecords.map((item) => { const key = `setLearningActive:${item.id}`; const active = aiBoolean(item.active); return <article className={styles.accountRow} key={item.id}><div><strong>{item.stage ?? "学段不限"} · {item.grade ?? "年级不限"}</strong><span>{item.audience ?? "对象不限"} · {item.tone ?? "语气不限"} · {String(item.createdAt ?? "").slice(0, 10)}</span></div><span className={styles.badge}>{active ? "启用" : "已停用"}</span><button type="button" className={styles.textButton} disabled={Boolean(busy[key])} onClick={() => void setLearningActive(Number(item.id), !active)}>{busy[key] ? "处理中…" : active ? "停用" : "启用"}</button></article>; })}</div> : <StateBox kind="empty" title="尚无个性化学习记录" description="保存反馈后，符合条件的脱敏样本才会出现在这里。" />}</div>
          <div className={styles.subsection}><h3>最近错误记录</h3><p className={styles.helper}>失败只记录错误码和简短原因，不保存完整请求或密钥。</p>{ai.usageDetail?.recentFailures?.length ? <div className={styles.auditList}>{ai.usageDetail.recentFailures.map((item) => <article key={item.id}><time>{String(item.createdAt ?? "").slice(0, 16)}</time><strong>{aiFeatureLabels[item.feature ?? ""] ?? "AI 辅助"}</strong><span>{item.errorCode ?? "AI_ERROR"}</span><em>{item.errorMessage ?? "服务调用失败"}</em></article>)}</div> : <StateBox kind="empty" title="暂无 AI 调用错误" description="服务端没有记录到最近的失败调用。" />}</div>
        </>}
      </section>

      <section className={styles.section} aria-labelledby="demo-heading">
        <SectionHeader eyebrow="安全演示" title="演示数据" id="demo-heading" description="创建与清理只处理带“【演示】”标记并由 demo_records 追踪的数据；真实教学数据不受影响。" />
        {demoState === "loading" && !demoRuns?.length && <StateBox kind="loading" title="正在读取演示数据状态" description="正在确认可清理的演示范围…" />}
        {demoState === "error" && <StateBox kind="error" title="演示数据状态读取失败" description={demoError} action={<RetryButton onClick={() => void loadDemo()} />} />}
        {demoState !== "loading" && demoRuns?.length === 0 && demoState === "ready" && <StateBox kind="empty" title="暂无演示数据" description="创建演示数据后，系统会明确展示追踪范围。" />}
        <div className={styles.actionCard}><strong>{demoRuns?.length ? `已找到 ${demoRuns.length} 组演示记录` : "创建综合演示工作区"}</strong><p>{demoRuns?.length ? "可以核验并补齐缺少的课时、作业、反馈、题库、组卷和素材；重复执行不会重复堆积。" : "生成带“【演示】”标记的完整教学闭环，不使用真实联系方式。"}</p><div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} disabled={Boolean(busy.seedDemo)} onClick={() => void seedDemo()}>{busy.seedDemo ? "核验与补齐中…" : demoRuns?.length ? "核验并补齐演示数据" : "创建综合演示数据"}</button>{Boolean(demoRuns?.length) && <button type="button" className={styles.dangerButton} disabled={Boolean(busy.clearDemo)} onClick={(event) => openDangerModal("demo", event.currentTarget)}>{busy.clearDemo ? "清理中…" : "清除演示数据"}</button>}</div></div>
      </section>

      <section className={`${styles.section} ${styles.dangerSection}`} aria-labelledby="data-heading">
        <SectionHeader eyebrow="高风险区域" title="数据导出与危险操作" id="data-heading" description="导出文件可能包含学生信息；删除教学数据不可恢复，账号与操作日志会保留。" />
        <div className={styles.actionGrid}>
          <article className={styles.actionCard}><strong>导出全部教学数据</strong><p>生成 JSON 备份，可能包含学生姓名、评价、反馈与监护人联系方式，请妥善保管。</p><button type="button" className={styles.secondaryButton} disabled={Boolean(busy.exportData)} onClick={() => void exportData()}>{busy.exportData ? "准备下载中…" : "二次确认后导出"}</button></article>
          <article className={styles.actionCard}><strong>导出常用表格</strong><p>现有中文 CSV 下载路由保持不变；下载前请确认文件保存位置安全。</p><div className={styles.linkRow}><a className={styles.linkButton} href="/api/exports/lessons">课时</a><a className={styles.linkButton} href="/api/exports/students">学生</a><a className={styles.linkButton} href="/api/exports/assessments">成绩</a><a className={styles.linkButton} href="/api/exports/assignments">作业</a></div></article>
          <article className={styles.actionCard}><strong>删除全部教学数据</strong><p>删除班级、学生、课时、题库、反馈、反思和资源。必须输入指定文字并再次确认；浏览器测试不执行真实删除。</p><button type="button" className={styles.dangerButton} onClick={(event) => openDangerModal("delete", event.currentTarget)}>进入危险操作</button></article>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="audit-heading">
        <SectionHeader eyebrow="可审计" title="操作日志" id="audit-heading" description="创建、修改、授权、停用、导出、密码和危险操作由服务端记录。" />
        {logs.length === 0 ? <StateBox kind="empty" title="还没有操作日志" description="完成一次设置变更后，日志会显示在这里。" /> : <><div className={styles.auditList}>{visibleLogs.map((log) => <article key={log.id}><time>{String(log.createdAt ?? "").slice(0, 16)}</time><strong>{log.userName ?? "系统"}</strong><span>{actionLabels[log.action ?? ""] ?? log.action ?? "未知操作"}</span><em>{log.entityType ?? "记录"}{log.entityId ? ` #${log.entityId}` : ""}</em></article>)}</div><div className={styles.buttonRow}>{logLimit < logs.length && <button type="button" className={styles.secondaryButton} onClick={() => setLogLimit((value) => Math.min(value + 30, logs.length))}>再显示 30 条</button>}{logLimit > 30 && <button type="button" className={styles.textButton} onClick={() => setLogLimit(30)}>收起到最近 30 条</button>}</div></>}
      </section>

      {dangerModal && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDangerModal(); }}><div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={`${dangerModal}-title`} aria-describedby={`${dangerModal}-description`} tabIndex={-1}>
        <header className={styles.dialogHeader}><div><p className={styles.eyebrow}>不可恢复前的最后一步</p><h2 id={`${dangerModal}-title`}>{dangerModal === "delete" ? "删除全部教学数据" : "清除演示数据"}</h2></div><button type="button" className={styles.iconButton} aria-label="关闭" onClick={() => closeDangerModal()}>×</button></header>
        {dangerModal === "delete" ? <><p id="delete-description" className={styles.helper}>建议先导出备份。请输入“{DELETE_CONFIRMATION}”，点击后还会出现第二次确认；浏览器测试不得执行真实删除。</p><label className={styles.field}><span>指定确认文字</span><input className={styles.input} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={() => closeDangerModal()}>取消</button><button type="button" className={styles.dangerButton} disabled={confirmation !== DELETE_CONFIRMATION || Boolean(busy.deleteData)} onClick={() => void deleteData()}>{busy.deleteData ? "删除中…" : "永久删除"}</button></div></> : <><p id="demo-description" className={styles.helper}>真实教学记录不会受影响。请输入“{DEMO_CONFIRMATION}”，并再次确认只清理带“【演示】”标记且被追踪的记录。</p><label className={styles.field}><span>指定确认文字</span><input className={styles.input} value={demoConfirmation} onChange={(event) => setDemoConfirmation(event.target.value)} /></label><div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={() => closeDangerModal()}>取消</button><button type="button" className={styles.dangerButton} disabled={demoConfirmation !== DEMO_CONFIRMATION || Boolean(busy.clearDemo)} onClick={() => void clearDemo()}>{busy.clearDemo ? "清理中…" : "清除演示数据"}</button></div></>}
      </div></div>}
    </div>
  </AppShell>;
}
