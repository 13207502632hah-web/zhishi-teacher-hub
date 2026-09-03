import { env } from "cloudflare:workers";
import { requireStudentAccess, type AccessContext } from "../access";
import type { MiniAccess } from "../mini-auth";
import { recordSyncEvent } from "./mini-sync-service";

type RegistrationRole = "student" | "parent";
type RegistrationInput = {
  role?: unknown;
  applicantName?: unknown;
  studentName?: unknown;
  classOrGrade?: unknown;
  relationship?: unknown;
};

const clean = (value: unknown, max: number) => String(value || "").trim().replace(/\s+/g, " ").slice(0, max);

export async function miniAccountState(access: MiniAccess, expiresAt?: string | null) {
  const [bindings, account, registration] = await Promise.all([
    env.DB.prepare("SELECT mb.id,mb.student_id AS studentId,s.name AS studentName,mb.role,mb.status,mb.confirmed_at AS confirmedAt FROM mini_bindings mb JOIN students s ON s.id=mb.student_id WHERE mb.account_id=? ORDER BY mb.status='active' DESC,s.name")
      .bind(access.accountId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT display_name AS displayName,student_id AS legacyStudentId FROM wechat_accounts WHERE id=?").bind(access.accountId).first<Record<string, unknown>>(),
    env.DB.prepare("SELECT id,role,applicant_name AS applicantName,student_name AS studentName,class_or_grade AS classOrGrade,relationship,status,created_at AS createdAt FROM mini_registration_requests WHERE account_id=? AND status='pending' ORDER BY updated_at DESC LIMIT 1")
      .bind(access.accountId).first<Record<string, unknown>>(),
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
    bindingRequired: active.length === 0,
    bindingStatus: active.length ? "active" : registration ? "pending" : "unbound",
    registration: registration || null,
    students: active,
    currentStudentId: active[0]?.studentId || null,
    expiresAt: expiresAt || null,
    features: { testLogin: false, subscriptionMessages: false, incrementalSync: true, offlineDrafts: true },
  };
}

export async function requestMiniRegistration(access: MiniAccess, input: RegistrationInput) {
  const activeBinding = await env.DB.prepare("SELECT id FROM mini_bindings WHERE account_id=? AND status='active' LIMIT 1")
    .bind(access.accountId).first<{ id: number }>();
  if (activeBinding) return Response.json({ error: "该微信账号已经完成注册，无需重复申请" }, { status: 409 });
  const role: RegistrationRole = input.role === "parent" ? "parent" : "student";
  const studentName = clean(input.studentName, 30);
  const classOrGrade = clean(input.classOrGrade, 40);
  const applicantName = role === "student" ? studentName : clean(input.applicantName, 30);
  const relationship = role === "parent" ? clean(input.relationship, 20) : "";
  if (!studentName || !classOrGrade || !applicantName || (role === "parent" && !relationship)) {
    return Response.json({ error: role === "parent" ? "请完整填写家长称呼、孩子姓名、班级或年级和关系" : "请完整填写学生姓名和班级或年级" }, { status: 400 });
  }
  const existing = await env.DB.prepare("SELECT id FROM mini_registration_requests WHERE account_id=? AND status='pending' ORDER BY updated_at DESC LIMIT 1")
    .bind(access.accountId).first<{ id: number }>();
  let registrationId = existing?.id;
  if (registrationId) {
    await env.DB.prepare("UPDATE mini_registration_requests SET role=?,applicant_name=?,student_name=?,class_or_grade=?,relationship=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(role, applicantName, studentName, classOrGrade, relationship || null, registrationId).run();
  } else {
    const created = await env.DB.prepare("INSERT INTO mini_registration_requests(account_id,role,applicant_name,student_name,class_or_grade,relationship,status) VALUES(?,?,?,?,?,?,'pending') RETURNING id")
      .bind(access.accountId, role, applicantName, studentName, classOrGrade, relationship || null).first<{ id: number }>();
    registrationId = created?.id;
  }
  await env.DB.prepare("UPDATE wechat_accounts SET role=?,display_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(role, applicantName, access.accountId).run();
  await recordSyncEvent({ eventType: "registration.requested", entityType: "mini_registration", entityId: Number(registrationId), audienceRole: "teacher", accountId: access.accountId, payload: { role, studentName, classOrGrade } });
  return Response.json({ ok: true, registrationId, status: "pending", role }, { status: 202 });
}

export async function listRegistrationRequests() {
  const rows = await env.DB.prepare("SELECT mr.id,mr.account_id AS accountId,wa.display_name AS displayName,mr.role,mr.applicant_name AS applicantName,mr.student_name AS studentName,mr.class_or_grade AS classOrGrade,mr.relationship,mr.status,mr.student_id AS studentId,s.name AS matchedStudentName,mr.created_at AS createdAt,mr.decided_at AS decidedAt FROM mini_registration_requests mr JOIN wechat_accounts wa ON wa.id=mr.account_id LEFT JOIN students s ON s.id=mr.student_id ORDER BY mr.status='pending' DESC,mr.updated_at DESC").all();
  return rows.results;
}

export async function listBindings() {
  const rows = await env.DB.prepare("SELECT mb.id,mb.account_id AS accountId,wa.display_name AS displayName,mb.student_id AS studentId,s.name AS studentName,mb.role,mb.status,mb.created_at AS createdAt,mb.confirmed_at AS confirmedAt FROM mini_bindings mb JOIN wechat_accounts wa ON wa.id=mb.account_id JOIN students s ON s.id=mb.student_id ORDER BY mb.status='active' DESC,mb.updated_at DESC").all();
  return rows.results;
}

export async function decideRegistration(access: AccessContext, registrationId: number, decision: "approve" | "reject", studentId?: number) {
  const registration = await env.DB.prepare("SELECT id,account_id AS accountId,role,status FROM mini_registration_requests WHERE id=?").bind(registrationId).first<Record<string, unknown>>();
  if (!registration) return Response.json({ error: "注册申请不存在" }, { status: 404 });
  if (registration.status !== "pending") return Response.json({ error: "该注册申请已经处理" }, { status: 409 });
  if (decision === "reject") {
    await env.DB.prepare("UPDATE mini_registration_requests SET status='rejected',decided_by=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(access.id, registrationId).run();
    await recordSyncEvent({ eventType: "registration.rejected", entityType: "mini_registration", entityId: registrationId, accountId: Number(registration.accountId), payload: { status: "rejected" } });
    return Response.json({ ok: true, status: "rejected" });
  }
  if (!studentId) return Response.json({ error: "批准前请选择对应学生档案" }, { status: 400 });
  const denied = await requireStudentAccess(access, studentId);
  if (denied) return denied;
  const student = await env.DB.prepare("SELECT id FROM students WHERE id=? AND status='active'").bind(studentId).first<{ id: number }>();
  if (!student) return Response.json({ error: "学生档案不存在或已停用" }, { status: 404 });
  const role = registration.role === "parent" ? "parent" : "student";
  const statements = [
    env.DB.prepare("UPDATE mini_registration_requests SET status='approved',student_id=?,decided_by=?,decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(studentId, access.id, registrationId),
    env.DB.prepare("INSERT INTO mini_bindings(account_id,student_id,role,status,confirmed_by,confirmed_at) VALUES(?,?,?,'active',?,CURRENT_TIMESTAMP) ON CONFLICT(account_id,student_id,role) DO UPDATE SET status='active',confirmed_by=excluded.confirmed_by,confirmed_at=CURRENT_TIMESTAMP,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP").bind(registration.accountId, studentId, role, access.id),
    env.DB.prepare("UPDATE wechat_accounts SET role=?,student_id=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(role, role === "student" ? studentId : null, registration.accountId),
  ];
  if (role === "parent") statements.push(env.DB.prepare("INSERT INTO parent_student_links(parent_account_id,student_id,status,confirmed_by) VALUES(?,?,'active',?) ON CONFLICT(parent_account_id,student_id) DO UPDATE SET status='active',confirmed_by=excluded.confirmed_by,updated_at=CURRENT_TIMESTAMP").bind(registration.accountId, studentId, access.id));
  await env.DB.batch(statements);
  await recordSyncEvent({ eventType: "registration.approved", entityType: "mini_registration", entityId: registrationId, accountId: Number(registration.accountId), studentId, payload: { status: "approved", role } });
  return Response.json({ ok: true, status: "approved", studentId });
}

export async function disableBinding(access: AccessContext, bindingId: number) {
  const binding = await env.DB.prepare("SELECT id,account_id AS accountId,student_id AS studentId,role,status FROM mini_bindings WHERE id=?").bind(bindingId).first<Record<string, unknown>>();
  if (!binding) return Response.json({ error: "绑定关系不存在" }, { status: 404 });
  const denied = await requireStudentAccess(access, Number(binding.studentId));
  if (denied) return denied;
  await env.DB.prepare("UPDATE mini_bindings SET status='disabled',confirmed_by=?,disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(access.id, bindingId).run();
  if (binding.role === "student") await env.DB.prepare("UPDATE wechat_accounts SET student_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND student_id=?").bind(binding.accountId, binding.studentId).run();
  if (binding.role === "parent") await env.DB.prepare("UPDATE parent_student_links SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE parent_account_id=? AND student_id=?").bind(binding.accountId, binding.studentId).run();
  await recordSyncEvent({ eventType: "binding.disabled", entityType: "mini_binding", entityId: bindingId, accountId: Number(binding.accountId), studentId: Number(binding.studentId), payload: { status: "disabled" } });
  return Response.json({ ok: true, status: "disabled" });
}
