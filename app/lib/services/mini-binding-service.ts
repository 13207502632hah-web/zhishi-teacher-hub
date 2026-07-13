import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import type { MiniAccess } from "../mini-auth";
import { miniTokenHash } from "../mini-auth";
import { recordSyncEvent } from "./mini-sync-service";

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
  const hash = await miniTokenHash(code.trim());
  const invite = await env.DB.prepare("SELECT id,role,student_id AS studentId FROM mini_invites WHERE code_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP")
    .bind(hash).first<{ id: number; role: string; studentId: number }>();
  if (!invite) return Response.json({ error: "邀请码无效或已过期，也可能已经使用" }, { status: 400 });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO mini_bindings(account_id,student_id,role,invite_id,status) VALUES(?,?,?,?, 'pending') ON CONFLICT(account_id,student_id,role) DO UPDATE SET invite_id=excluded.invite_id,status='pending',confirmed_by=NULL,confirmed_at=NULL,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP")
      .bind(access.accountId, invite.studentId, invite.role, invite.id),
    env.DB.prepare("UPDATE mini_invites SET used_at=CURRENT_TIMESTAMP WHERE id=? AND used_at IS NULL").bind(invite.id),
    env.DB.prepare("UPDATE wechat_accounts SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(invite.role, access.accountId),
  ]);
  await recordSyncEvent({ eventType: "binding.requested", entityType: "student", entityId: invite.studentId, audienceRole: "teacher", accountId: access.accountId, payload: { role: invite.role } });
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
  await env.DB.prepare("UPDATE mini_bindings SET status=?,confirmed_by=?,confirmed_at=CASE WHEN ?='active' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,disabled_at=CASE WHEN ?='disabled' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(status, access.id, status, status, bindingId).run();
  if (status === "active" && binding.role === "student") {
    await env.DB.prepare("UPDATE wechat_accounts SET student_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(binding.studentId, binding.accountId).run();
  }
  if (status !== "active" && binding.role === "student") {
    await env.DB.prepare("UPDATE wechat_accounts SET student_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND student_id=?").bind(binding.accountId, binding.studentId).run();
  }
  if (binding.role === "parent") {
    if (status === "active") await env.DB.prepare("INSERT INTO parent_student_links(parent_account_id,student_id,status,confirmed_by) VALUES(?,?, 'active',?) ON CONFLICT(parent_account_id,student_id) DO UPDATE SET status='active',confirmed_by=excluded.confirmed_by,updated_at=CURRENT_TIMESTAMP").bind(binding.accountId, binding.studentId, access.id).run();
    else await env.DB.prepare("UPDATE parent_student_links SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE parent_account_id=? AND student_id=?").bind(binding.accountId, binding.studentId).run();
  }
  await recordSyncEvent({ eventType: `binding.${status}`, entityType: "mini_binding", entityId: bindingId, accountId: Number(binding.accountId), studentId: Number(binding.studentId), payload: { status } });
  return Response.json({ ok: true, status });
}
