"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./mini-settings.module.css";

type Role = "parent" | "student";
type Decision = "confirm" | "reject" | "disable";
type LoadState = "loading" | "ready" | "error";
type BindingStatus = "pending" | "active" | "rejected" | "disabled";

type Student = {
  grade?: string;
  id: number;
  name: string;
};

type MiniAccount = {
  createdAt?: string | null;
  displayName?: string | null;
  id: number;
  linkedTeacher?: string | null;
  role: string;
  status?: string | null;
  userId?: number | null;
};

type Binding = {
  accountId?: number;
  confirmedAt?: string | null;
  createdAt?: string | null;
  displayName?: string | null;
  id: number;
  role: Role;
  status: BindingStatus;
  studentId: number;
  studentName?: string | null;
};

type InviteReceipt = {
  code: string;
  expiresAt: string;
  role: Role;
  studentId: number;
  studentName: string;
};

const roleLabels: Record<Role, string> = { parent: "家长", student: "学生" };
const roleDescriptions: Record<Role, string> = {
  parent: "家长仅能在教师确认后查看对应孩子的已确认内容",
  student: "学生仅能在教师确认后查看本人已确认内容",
};

const statusMeta: Record<BindingStatus, { description: string; label: string }> = {
  pending: { description: "邀请码已提交，学生数据仍未开放。", label: "待确认" },
  active: { description: "教师已确认，按这条绑定关系开放对应学生数据。", label: "已生效" },
  rejected: { description: "教师已拒绝，不会开放对应学生数据。", label: "已拒绝" },
  disabled: { description: "教师已停用，旧会话下一次请求也会失去该学生权限。", label: "已停用" },
};

const statusClass: Record<BindingStatus, string> = {
  pending: styles.statusPending,
  active: styles.statusActive,
  rejected: styles.statusRejected,
  disabled: styles.statusDisabled,
};

function failureMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function formatDateTime(value?: string | null) {
  if (!value) return "时间未返回";
  return value.replace("T", " ").slice(0, 16);
}

function isAbort(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function LoadError({ error, onRetry, retryLabel, title }: { error: string; onRetry: () => void; retryLabel: string; title: string }) {
  return (
    <div className={styles.loadError} role="alert">
      <div>
        <strong>{title}</strong>
        <p>{error}</p>
      </div>
      <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

function EmptyBlock({ description, title }: { description: string; title: string }) {
  return (
    <div className={styles.emptyBlock}>
      <span className={styles.emptyMark} aria-hidden="true">知</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: BindingStatus }) {
  return <span className={`${styles.status} ${statusClass[status]}`}>{statusMeta[status].label}</span>;
}

export default function MiniSettingsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [accounts, setAccounts] = useState<MiniAccount[]>([]);
  const [studentsState, setStudentsState] = useState<LoadState>("loading");
  const [bindingsState, setBindingsState] = useState<LoadState>("loading");
  const [accountsState, setAccountsState] = useState<LoadState>("loading");
  const [studentsError, setStudentsError] = useState("");
  const [bindingsError, setBindingsError] = useState("");
  const [accountsError, setAccountsError] = useState("");
  const [studentId, setStudentId] = useState("");
  const [role, setRole] = useState<Role>("parent");
  const [invite, setInvite] = useState<InviteReceipt | null>(null);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadStudents = useCallback(async (signal?: AbortSignal) => {
    setStudentsState("loading");
    setStudentsError("");
    try {
      const data = await requestJson<{ students?: Student[] }>("/api/students", { signal });
      if (!data) throw new HttpError(200, "学生列表响应为空，请重试");
      setStudents(data.students || []);
      setStudentsState("ready");
    } catch (reason) {
      if (signal?.aborted || isAbort(reason)) return;
      setStudents([]);
      setStudentsError(failureMessage(reason, "暂时无法读取学生档案"));
      setStudentsState("error");
    }
  }, []);

  const loadBindings = useCallback(async (signal?: AbortSignal) => {
    setBindingsState("loading");
    setBindingsError("");
    try {
      const data = await requestJson<{ bindings?: Binding[] }>("/api/mini/invites", { signal });
      if (!data) throw new HttpError(200, "绑定列表响应为空，请重试");
      setBindings(data.bindings || []);
      setBindingsState("ready");
    } catch (reason) {
      if (signal?.aborted || isAbort(reason)) return;
      setBindings([]);
      setBindingsError(failureMessage(reason, "暂时无法读取绑定申请"));
      setBindingsState("error");
    }
  }, []);

  const loadAccounts = useCallback(async (signal?: AbortSignal) => {
    setAccountsState("loading");
    setAccountsError("");
    try {
      const data = await requestJson<{ accounts?: MiniAccount[] }>("/api/mini/accounts", { signal });
      if (!data) throw new HttpError(200, "账号列表响应为空，请重试");
      setAccounts(data.accounts || []);
      setAccountsState("ready");
    } catch (reason) {
      if (signal?.aborted || isAbort(reason)) return;
      setAccounts([]);
      setAccountsError(failureMessage(reason, "暂时无法读取小程序账号"));
      setAccountsState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudents(controller.signal);
    void loadBindings(controller.signal);
    void loadAccounts(controller.signal);
    return () => controller.abort();
  }, [loadAccounts, loadBindings, loadStudents]);

  const selectedStudent = useMemo(
    () => students.find((student) => String(student.id) === studentId) || null,
    [studentId, students],
  );

  const inviteRoleDescription = roleDescriptions[role];

  const createInvite = async () => {
    if (!selectedStudent || actionBusy) return;
    setInvite(null);
    setActionError("");
    setMessage("");
    setActionBusy("invite:create");
    try {
      const data = await requestJson<{ code?: string; expiresAt?: string; role?: Role; studentId?: number }>("/api/mini/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, studentId: selectedStudent.id }),
      });
      if (!data?.code || !data.expiresAt) throw new HttpError(200, "邀请码响应不完整，请重试");
      setInvite({
        code: data.code,
        expiresAt: data.expiresAt,
        role: data.role || role,
        studentId: data.studentId || selectedStudent.id,
        studentName: selectedStudent.name,
      });
      setMessage("邀请码已生成；仅在本次页面操作中显示一次，输入后不会开放学生数据。请把角色、对应学生和有效期一并交给对方。 ");
    } catch (reason) {
      setActionError(failureMessage(reason, "生成邀请码失败"));
    } finally {
      setActionBusy(null);
    }
  };

  const decideBinding = async (binding: Binding, decision: Decision) => {
    if (actionBusy) return;
    const impact = decision === "confirm"
      ? "确认这条绑定关系？确认后该账号只能按对应学生的已确认内容读取数据。"
      : decision === "reject"
        ? "拒绝这条绑定关系？拒绝后不会开放对应学生数据，对方需要新的邀请码重新申请。"
        : "停用这条绑定关系？停用后旧会话下一次请求立即失去该学生数据权限，其他有效绑定不受影响。";
    if (!window.confirm(impact)) return;
    setActionBusy(`binding:${binding.id}:${decision}`);
    setActionError("");
    setMessage("");
    try {
      await requestJson<{ ok?: boolean; status?: BindingStatus }>(`/api/mini/bindings/${binding.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const label = decision === "confirm" ? "确认" : decision === "reject" ? "拒绝" : "停用";
      setMessage(`已${label}绑定；若页面上再次提交，服务端会拒绝重复处理。`);
      void loadBindings();
    } catch (reason) {
      setActionError(failureMessage(reason, "绑定状态已变化，请刷新后重试"));
      void loadBindings();
    } finally {
      setActionBusy(null);
    }
  };

  const linkTeacher = async (account: MiniAccount) => {
    if (actionBusy) return;
    if (!window.confirm("确认关联这个小程序账号为教师端？关联后该账号成为教师入口，原有学生/家长绑定会被停用；页面不会展示敏感身份标识。")) return;
    setActionBusy(`account:${account.id}`);
    setActionError("");
    setMessage("");
    try {
      await requestJson<{ ok?: boolean }>("/api/mini/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id, action: "linkTeacher" }),
      });
      setMessage("小程序账号已关联为教师端；原有学生/家长绑定按安全边界停用。 ");
      void loadAccounts();
      void loadBindings();
    } catch (reason) {
      setActionError(failureMessage(reason, "教师端关联失败"));
    } finally {
      setActionBusy(null);
    }
  };

  const pendingCount = bindings.filter((binding) => binding.status === "pending").length;
  const activeCount = bindings.filter((binding) => binding.status === "active").length;
  const availableAccounts = accounts.filter((account) => account.role !== "teacher" || !account.userId);

  return (
    <AppShell title="微信小程序" subtitle="教师关联、一次性邀请码与两步绑定确认">
      <div className={styles.page}>
        <section className={styles.intro} aria-labelledby="mini-settings-heading">
          <div className={styles.introMain}>
            <p className={styles.eyebrow}>低频入口 / 安全边界</p>
            <h2 id="mini-settings-heading">只在需要时管理移动端关联</h2>
            <p className={styles.introText}>小程序继续作为作业、查看和轻量确认的移动补充。教师网站仍是正式管理与最终确认入口，本页不扩展聊天、排行、收费或自动群发。</p>
          </div>
          <aside className={styles.securityNote} aria-label="隐私边界">
            <strong>隐私边界</strong>
            <p>本页只显示脱敏角色、学生姓名、状态和时间；敏感凭据与完整身份标识由服务端保管，不在页面展示。</p>
          </aside>
        </section>

        <ol className={styles.flow} aria-label="小程序绑定流程">
          <li className={styles.flowItem}><span className={styles.flowIndex}>1</span><span><b>教师端关联</b><small>先确认小程序教师身份</small></span></li>
          <li className={styles.flowItem}><span className={styles.flowIndex}>2</span><span><b>生成邀请码</b><small>角色、学生和过期时间明确</small></span></li>
          <li className={styles.flowItem}><span className={styles.flowIndex}>3</span><span><b>用户提交绑定</b><small>提交后保持待确认</small></span></li>
          <li className={styles.flowItem}><span className={styles.flowIndex}>4</span><span><b>教师最终确认</b><small>确认、拒绝、停用可追溯</small></span></li>
        </ol>

        {message && <div className={styles.notice} role="status">{message}</div>}
        {actionError && <div className={`${styles.notice} ${styles.noticeError}`} role="alert">{actionError}</div>}

        <div className={styles.sectionGrid}>
          <section className={styles.panel} aria-labelledby="teacher-link-heading">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>第一步 / 教师本人</p>
                <h2 id="teacher-link-heading">关联小程序教师端</h2>
                <p className={styles.panelDescription}>只关联你已核对的本地演示账号。关联后，原有学生/家长绑定会停用，避免同一账号跨角色残留权限。</p>
              </div>
              <span className={styles.count}>{availableAccounts.length} 个待处理</span>
            </header>
            {accountsState === "error" ? (
              <LoadError error={accountsError} onRetry={() => void loadAccounts()} retryLabel="重新读取账号" title="账号列表暂时不可用" />
            ) : accountsState === "loading" ? (
              <p className={styles.loading} role="status">正在读取账号列表…</p>
            ) : availableAccounts.length === 0 ? (
              <EmptyBlock description="当前没有待关联账号。需要时再用本地演示账号打开小程序入口。" title="暂无待关联小程序账号" />
            ) : (
              <div className={styles.cardList}>
                {availableAccounts.map((account) => (
                  <article className={styles.accountCard} key={account.id}>
                    <div className={styles.cardMain}>
                      <h3>{account.displayName || "微信用户"}</h3>
                      <p>{account.role === "parent" ? "家长" : account.role === "student" ? "学生" : "待识别身份"} · {account.status === "active" ? "账号可用" : "账号待处理"}</p>
                      <small>创建于 {formatDateTime(account.createdAt)}</small>
                    </div>
                    <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" disabled={Boolean(actionBusy)} onClick={() => void linkTeacher(account)}>
                      {actionBusy === `account:${account.id}` ? "关联中…" : "关联为教师端"}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="invite-heading">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>第二步 / 教师发起</p>
                <h2 id="invite-heading">生成一次性邀请码</h2>
                <p className={styles.panelDescription}>邀请码有效 7 天，只在生成成功后显示一次；数据库只保存不可逆摘要，输入后必须回到教师端确认。</p>
              </div>
            </header>
            {studentsState === "error" ? (
              <LoadError error={studentsError} onRetry={() => void loadStudents()} retryLabel="重新读取学生" title="学生列表暂时不可用" />
            ) : studentsState === "loading" ? (
              <p className={styles.loading} role="status">正在读取学生列表…</p>
            ) : students.length === 0 ? (
              <EmptyBlock description="先建立学生档案，再为具体学生生成绑定邀请码。" title="暂无可关联学生" />
            ) : (
              <>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>对应学生</span>
                    <select value={studentId} onChange={(event) => { setStudentId(event.target.value); setInvite(null); }}>
                      <option value="">请选择学生</option>
                      {students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.grade || "年级未填"}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>绑定角色</span>
                    <select value={role} onChange={(event) => { setRole(event.target.value as Role); setInvite(null); }}>
                      <option value="parent">家长</option>
                      <option value="student">学生</option>
                    </select>
                  </label>
                </div>
                <p className={styles.helper}>{inviteRoleDescription}</p>
                <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" disabled={!selectedStudent || Boolean(actionBusy)} onClick={() => void createInvite()}>
                  {actionBusy === "invite:create" ? "正在生成…" : "生成邀请码"}
                </button>
                {invite && (
                  <div className={styles.inviteReceipt} role="status" aria-live="polite">
                    <div className={styles.inviteHeading}><strong>邀请码仅显示一次</strong><span>{roleLabels[invite.role]}</span></div>
                    <code className={styles.inviteCode}>{invite.code}</code>
                    <dl className={styles.inviteMeta}>
                      <div><dt>对应学生</dt><dd>{invite.studentName}</dd></div>
                      <div><dt>绑定角色</dt><dd>{roleLabels[invite.role]}</dd></div>
                      <div><dt>有效期至</dt><dd>{formatDateTime(invite.expiresAt)}</dd></div>
                    </dl>
                    <p>请当面或通过安全渠道交给对应用户。输入后不会开放学生数据，直到教师完成最终确认。</p>
                  </div>
                )}
              </>
            )}
          </section>

          <section className={`${styles.panel} ${styles.bindingPanel}`} aria-labelledby="binding-heading">
            <header className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>第三、四步 / 教师最终决定</p>
                <h2 id="binding-heading">教师确认学生/家长绑定与安全状态</h2>
                <p className={styles.panelDescription}>输入邀请码只会创建待确认申请。确认、拒绝和停用都会说明影响；已处理状态不能重复提交。</p>
              </div>
              <div className={styles.countGroup}><span>待确认 {pendingCount}</span><span>已生效 {activeCount}</span></div>
            </header>
            {bindingsState === "error" ? (
              <LoadError error={bindingsError} onRetry={() => void loadBindings()} retryLabel="重新读取绑定" title="绑定列表暂时不可用" />
            ) : bindingsState === "loading" ? (
              <p className={styles.loading} role="status">正在读取绑定申请…</p>
            ) : bindings.length === 0 ? (
              <EmptyBlock description="当用户提交一次性邀请码后，申请会显示为待确认；在此之前不会开放学生数据。" title="暂无绑定申请" />
            ) : (
              <div className={styles.cardList}>
                {bindings.map((binding) => {
                  const meta = statusMeta[binding.status];
                  const busy = actionBusy?.startsWith(`binding:${binding.id}:`) || false;
                  return (
                    <article className={styles.bindingCard} key={binding.id}>
                      <div className={styles.bindingTop}>
                        <div className={styles.cardMain}>
                          <h3>{binding.displayName || "微信用户"} <span aria-hidden="true">→</span> {binding.studentName || "学生姓名不可用"}</h3>
                          <p>{roleLabels[binding.role]} · 申请于 {formatDateTime(binding.createdAt)}</p>
                        </div>
                        <StatusBadge status={binding.status} />
                      </div>
                      <p className={styles.statusDescription}>{meta.description}</p>
                      {binding.status === "pending" && (
                        <div className={styles.bindingActions}>
                          <button className={`${styles.button} ${styles.buttonPrimary}`} type="button" disabled={Boolean(actionBusy)} onClick={() => void decideBinding(binding, "confirm")}>
                            {busy && actionBusy?.endsWith(":confirm") ? "确认中…" : "确认绑定"}
                          </button>
                          <button className={`${styles.button} ${styles.buttonDanger}`} type="button" disabled={Boolean(actionBusy)} onClick={() => void decideBinding(binding, "reject")}>
                            {busy && actionBusy?.endsWith(":reject") ? "拒绝中…" : "拒绝申请"}
                          </button>
                        </div>
                      )}
                      {binding.status === "active" && (
                        <div className={styles.bindingActions}>
                          <button className={`${styles.button} ${styles.buttonDanger}`} type="button" disabled={Boolean(actionBusy)} onClick={() => void decideBinding(binding, "disable")}>
                            {busy ? "停用中…" : "停用绑定"}
                          </button>
                        </div>
                      )}
                      {(binding.status === "rejected" || binding.status === "disabled") && <p className={styles.noAction}>该申请已处理，不能重复确认、拒绝或停用。</p>}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className={styles.scope} aria-labelledby="scope-heading">
          <div>
            <p className={styles.eyebrow}>范围保持不变</p>
            <h2 id="scope-heading">小程序仍是暂停/低频入口</h2>
          </div>
          <p>本轮只重设计教师关联、邀请码和绑定安全状态。作业查看、提交、批改确认与同步继续沿用既有权限边界；不新增聊天、排行、收费、自动群发或其他社交功能。</p>
        </section>
      </div>
    </AppShell>
  );
}
