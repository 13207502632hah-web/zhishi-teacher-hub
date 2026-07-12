import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission, roleName, type RoleCode } from "../../lib/access";

const allowedRoles: RoleCode[] = ["teacher", "assistant", "student", "parent"];

export async function GET() {
  const access = await requirePermission("settings:read"); if (isDenied(access)) return access;
  const [users, students, classes, staffClassAccess, logs] = await Promise.all([
    env.DB.prepare("SELECT u.id,u.name,u.email,u.status,GROUP_CONCAT(r.code) AS roles,GROUP_CONCAT(r.name) AS roleNames FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id GROUP BY u.id ORDER BY u.created_at").all(),
    env.DB.prepare("SELECT id,name,grade,user_id AS userId,guardian_user_id AS guardianUserId FROM students ORDER BY name").all(),
    env.DB.prepare("SELECT id,name,stage,grade FROM classes WHERE status='active' ORDER BY grade,name").all(),
    env.DB.prepare("SELECT user_id AS userId,class_id AS classId FROM staff_class_access").all(),
    env.DB.prepare("SELECT a.id,a.action,a.entity_type AS entityType,a.entity_id AS entityId,a.detail,a.created_at AS createdAt,u.name AS userName,u.email AS userEmail FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 120").all(),
  ]);
  const configuredAccount = String(env.TEACHER_ADMIN_ACCOUNT || "");
  const accountLabel = configuredAccount.length > 7 ? `${configuredAccount.slice(0, 3)}****${configuredAccount.slice(-4)}` : "已配置";
  return Response.json({ current: { id: access.id, name: "教师管理员", accountLabel, role: access.role, roleName: roleName[access.role] }, users: users.results, students: students.results, classes: classes.results, staffClassAccess: staffClassAccess.results, logs: logs.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("settings:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, action = String(body.action || "upsertUser");
  if (action === "upsertUser") {
    const email = String(body.email || "").trim().toLowerCase(), name = String(body.name || "").trim(), role = String(body.role || "") as RoleCode, studentId = Number(body.studentId || 0);
    if (!email || !name || !allowedRoles.includes(role)) return Response.json({ error: "姓名、邮箱和角色为必填项" }, { status: 400 });
    const target = await env.DB.prepare("INSERT INTO users(name,email,status) VALUES(?,?,'active') ON CONFLICT(email) DO UPDATE SET name=excluded.name,status='active',updated_at=CURRENT_TIMESTAMP RETURNING id").bind(name, email).first<{ id: number }>();
    if (!target) return Response.json({ error: "账号保存失败" }, { status: 500 });
    if (target.id === access.id && role !== "teacher") return Response.json({ error: "不能移除当前账号的教师权限" }, { status: 400 });
    const roleRow = await env.DB.prepare("SELECT id FROM roles WHERE code=?").bind(role).first<{ id: number }>();
    await env.DB.batch([env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(target.id), env.DB.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(target.id, roleRow?.id)]);
    await env.DB.prepare("UPDATE students SET user_id=CASE WHEN user_id=? THEN NULL ELSE user_id END,guardian_user_id=CASE WHEN guardian_user_id=? THEN NULL ELSE guardian_user_id END").bind(target.id, target.id).run();
    if (studentId && role === "student") await env.DB.prepare("UPDATE students SET user_id=? WHERE id=?").bind(target.id, studentId).run();
    if (studentId && role === "parent") await env.DB.prepare("UPDATE students SET guardian_user_id=? WHERE id=?").bind(target.id, studentId).run();
    await audit(access, "assign_role", "user", target.id, { role, linkedStudentId: studentId || null });
    return Response.json({ ok: true, userId: target.id });
  }
  if (action === "disableUser") {
    const userId = Number(body.userId || 0); if (!userId || userId === access.id) return Response.json({ error: "不能停用当前登录账号" }, { status: 400 });
    await env.DB.prepare("UPDATE users SET status='disabled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(userId).run();
    await audit(access, "disable", "user", userId); return Response.json({ ok: true });
  }
  if (action === "setClassAccess") {
    const userId = Number(body.userId || 0), classIds = [...new Set((Array.isArray(body.classIds) ? body.classIds : []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
    const target = await env.DB.prepare("SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?").bind(userId).first<{ code: string }>();
    if (!userId || target?.code !== "assistant") return Response.json({ error: "只能为已启用的助教分配班级" }, { status: 400 });
    const available = await env.DB.prepare(`SELECT COUNT(*) AS total FROM classes WHERE status='active' AND id IN (${classIds.map(() => "?").join(",") || "NULL"})`).bind(...classIds).first<{ total: number }>();
    if (Number(available?.total || 0) !== classIds.length) return Response.json({ error: "包含不存在或已归档的班级" }, { status: 400 });
    const statements = [env.DB.prepare("DELETE FROM staff_class_access WHERE user_id=?").bind(userId), ...classIds.map((classId) => env.DB.prepare("INSERT INTO staff_class_access(user_id,class_id) VALUES(?,?)").bind(userId, classId))];
    await env.DB.batch(statements);
    await audit(access, "assign_class_scope", "user", userId, { classIds });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "不支持的设置操作" }, { status: 400 });
}
