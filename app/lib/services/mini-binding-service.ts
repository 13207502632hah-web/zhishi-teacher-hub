import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import type { MiniAccess } from "../mini-auth";
import { miniTokenHash } from "../mini-auth";

export async function miniAccountState(access: MiniAccess, expiresAt?: string | null) {
  const [bindings, account] = await Promise.all([
    env.DB.prepare("SELECT mb.id,mb.student_id AS studentId,s.name AS studentName,mb.role,mb.status,mb.confirmed_at AS confirmedAt FROM mini_bindings mb JOIN students s ON s.id=mb.student_id WHERE mb.account_id=? ORDER BY mb.status='active' DESC,s.name")
      .bind(access.accountId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT display_name AS displayName,user_id AS userId,student_id AS legacyStudentId FROM wechat_accounts WHERE id=?").bind(access.accountId).first<Record<string, unknown>>(),
  ]);
  const active = bindings.results.filter((item) => item.status === "active");
  if (!active.length && access.role === "student" && access.studentId) {
    const student = await env.DB.prepare("SELECT id AS studentId,name AS studentName FROM students WHERE id=?").bind(access.studentId).first<Record<string, unknown>>();
    if (student) active.push({ ...student, role: "student", status: "active", legacy: true });
  }
  if (!active.length && access.role === "parent") {
    const legacy = await env.DB.prepare("SELECT p.student_id AS studentId,s.name AS studentName,'parent' AS role,'active' AS status FROM parent_student_links p JOIN students s ON s.id=p.student_id WHERE p.parent_account_id=? AND p.status='active'").bind(access.accountId).all<Record<string, unknown>>();
    active.push(...legacy.results);
  }
  return {
    accountId: access.accountId,
    displayName: account?.displayName || "微信用户",
    role: access.role,
    bindingRequired: access.role !== "teacher" && active.length === 0,
    bindingStatus: active.length ? "active" : bindings.results.some((item) => item.status === "pending") ? "pending" : "unbound",
    students: active,
    pendingBindings: bindings.results.filter((item) => item.status === "pending"),
    currentStudentId: active[0]?.studentId || null,
    teacherLinked: access.role !== "teacher" || Boolean(access.userId),
    expiresAt: expiresAt || null,
    features: { testLogin: false, subscriptionMessages: false, incrementalSync: true, offlineDrafts: true },
  };
}

export async function requestMiniBinding(access: MiniAccess, code: string) {
  if (access.role === "teacher") return Response.json({ error: "教师账号不能改绑为学生或家长" }, { status: 400 });
  const normalizedCode = code.trim();
  if (!normalizedCode) return Response.json({ error: "请输入邀请码" }, { status: 400 });
  const hash = await miniTokenHash(normalizedCode);
  const invite = await env.DB.prepare("SELECT id,role,student_id AS studentId FROM mini_invites WHERE code_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP")
    .bind(hash).first<{ id: number; role: string; studentId: number }>();
  if (!invite) return Response.json({ error: "邀请码无效或已过期，也可能已经使用" }, { status: 400 });

  const statements: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO mini_bindings(account_id,student_id,role,invite_id,status) SELECT ?,?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM mini_invites WHERE id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP) ON CONFLICT(account_id,student_id,role) DO UPDATE SET invite_id=excluded.invite_id,status='pending',confirmed_by=NULL,confirmed_at=NULL,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP")
      .bind(access.accountId, invite.studentId, invite.role, invite.id, invite.id),
    env.DB.prepare("UPDATE wechat_accounts SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM mini_invites WHERE id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP)").bind(invite.role, access.accountId, invite.id),
    env.DB.prepare("INSERT INTO sync_events(event_type,entity_type,entity_id,audience_role,student_id,account_id,payload,is_deleted) SELECT 'binding.requested','student',?,'teacher',NULL,?,?,0 WHERE EXISTS(SELECT 1 FROM mini_invites WHERE id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP)")
      .bind(String(invite.studentId), access.accountId, JSON.stringify({ role: invite.role }), invite.id),
    env.DB.prepare("UPDATE mini_invites SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP").bind(invite.id),
  ];
  const results = await env.DB.batch(statements);
  const consumed = results[results.length - 1];
  if (Number(consumed?.meta?.changes || 0) !== 1) return Response.json({ error: "邀请码无效或已过期，也可能已经使用" }, { status: 409 });
  return Response.json({ ok: true, status: "pending", role: invite.role, studentId: invite.studentId }, { status: 202 });
}

export async function listBindingRequests() {
  const rows = await env.DB.prepare("SELECT mb.id,mb.account_id AS accountId,wa.display_name AS displayName,mb.student_id AS studentId,s.name AS studentName,mb.role,mb.status,mb.created_at AS createdAt,mb.confirmed_at AS confirmedAt FROM mini_bindings mb JOIN wechat_accounts wa ON wa.id=mb.account_id JOIN students s ON s.id=mb.student_id ORDER BY mb.status='pending' DESC,mb.updated_at DESC").all();
  return rows.results;
}

export async function decideBinding(access: AccessContext, bindingId: number, decision: "confirm" | "reject" | "disable") {
  const binding = await env.DB.prepare("SELECT id,account_id AS accountId,student_id AS studentId,role,status FROM mini_bindings WHERE id=?").bind(bindingId).first<Record<string, unknown>>();
  if (!binding) return Response.json({ error: "绑定申请不存在" }, { status: 404 });
  const status = decision === "confirm" ? "active" : decision === "reject" ? "rejected" : "disabled";
  const expectedStatus = decision === "disable" ? "active" : "pending";
  if (binding.status !== expectedStatus) return Response.json({ error: `当前绑定已是${binding.status === "active" ? "已生效" : binding.status === "rejected" ? "已拒绝" : binding.status === "disabled" ? "已停用" : "待确认"}，不能重复处理` }, { status: 409 });
  const statements: D1PreparedStatement[] = [];
  if (status === "active" && binding.role === "student") {
    statements.push(env.DB.prepare("UPDATE wechat_accounts SET student_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND EXISTS(SELECT 1 FROM mini_bindings WHERE id=? AND status=?)").bind(binding.studentId, binding.accountId, bindingId, expectedStatus));
  }
  if (status !== "active" && binding.role === "student") {
    statements.push(env.DB.prepare("UPDATE wechat_accounts SET student_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND student_id=? AND EXISTS(SELECT 1 FROM mini_bindings WHERE id=? AND status=?)").bind(binding.accountId, binding.studentId, bindingId, expectedStatus));
  }
  if (binding.role === "parent") {
    if (status === "active") statements.push(env.DB.prepare("INSERT INTO parent_student_links(parent_account_id,student_id,status,confirmed_by) SELECT account_id,student_id,'active',? FROM mini_bindings WHERE id=? AND status=? AND role='parent' ON CONFLICT(parent_account_id,student_id) DO UPDATE SET status='active',confirmed_by=excluded.confirmed_by,updated_at=CURRENT_TIMESTAMP").bind(access.id, bindingId, expectedStatus));
    else statements.push(env.DB.prepare("UPDATE parent_student_links SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE parent_account_id=? AND student_id=? AND EXISTS(SELECT 1 FROM mini_bindings WHERE id=? AND status=?)").bind(binding.accountId, binding.studentId, bindingId, expectedStatus));
  }
  statements.push(env.DB.prepare("INSERT INTO sync_events(event_type,entity_type,entity_id,audience_role,student_id,account_id,payload,is_deleted) SELECT ?, 'mini_binding',CAST(id AS TEXT),NULL,student_id,account_id,?,0 FROM mini_bindings WHERE id=? AND status=?")
    .bind(`binding.${status}`, JSON.stringify({ status }), bindingId, expectedStatus));
  statements.push(env.DB.prepare("UPDATE mini_bindings SET status=?,confirmed_by=?,confirmed_at=CASE WHEN ?='active' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,disabled_at=CASE WHEN ?='disabled' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?")
    .bind(status, access.id, status, status, bindingId, expectedStatus));
  const results = await env.DB.batch(statements);
  const updated = results[results.length - 1];
  if (Number(updated?.meta?.changes || 0) !== 1) return Response.json({ error: "绑定状态已变化，不能重复处理，请刷新后重试" }, { status: 409 });
  return Response.json({ ok: true, status });
}
