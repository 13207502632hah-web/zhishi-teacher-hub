import { env } from "cloudflare:workers";
import { getTeacherAdminSession } from "./teacher-auth";

export type RoleCode = "teacher" | "assistant" | "student" | "parent";
export type AccessContext = { id: number; name: string; email: string; roles: RoleCode[]; role: RoleCode };

const permissions: Record<RoleCode, string[]> = {
  teacher: ["*"],
  assistant: ["dashboard:read", "classes:read", "students:read", "lessons:read", "lessons:write", "questions:read", "questions:write", "papers:read", "papers:write", "feedback:read", "feedback:write", "resources:read", "resources:private", "resources:write"],
  student: ["portal:read", "resources:read"],
  parent: ["portal:read", "resources:read"],
};

async function seedRoles() {
  const db = env.DB;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO roles(code,name) VALUES('teacher','教师')"),
    db.prepare("INSERT OR IGNORE INTO roles(code,name) VALUES('assistant','助教')"),
    db.prepare("INSERT OR IGNORE INTO roles(code,name) VALUES('student','学生')"),
    db.prepare("INSERT OR IGNORE INTO roles(code,name) VALUES('parent','家长')"),
  ]);
}

export async function getAccess(): Promise<AccessContext | null> {
  if (await getTeacherAdminSession()) return getTeacherAdminAccess();
  return null;
}

async function getTeacherAdminAccess(): Promise<AccessContext | null> {
  await seedRoles();
  const db = env.DB;
  // The app-owned teacher administrator must never inherit a hosting service
  // identity merely because that record happened to be created first.
  let user = await db.prepare("SELECT id,name,email FROM users WHERE email='teacher-admin@local.invalid' AND status='active'").first<{ id: number; name: string; email: string }>();
  if (!user) {
    await db.prepare("INSERT OR IGNORE INTO users(name,email,status) VALUES('教师管理员','teacher-admin@local.invalid','active')").run();
    user = await db.prepare("SELECT id,name,email FROM users WHERE email='teacher-admin@local.invalid'").first<{ id: number; name: string; email: string }>();
    const teacher = await db.prepare("SELECT id FROM roles WHERE code='teacher'").first<{ id: number }>();
    if (user && teacher) await db.prepare("INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)").bind(user.id, teacher.id).run();
  }
  if (!user) return null;
  return { id: Number(user.id), name: String(user.name), email: String(user.email), roles: ["teacher"], role: "teacher" };
}

export function can(access: AccessContext, permission: string) {
  return permissions[access.role].includes("*") || permissions[access.role].includes(permission);
}

export async function requirePermission(permission: string): Promise<AccessContext | Response> {
  const access = await getAccess();
  if (!access) return Response.json({ error: "请先使用教师管理员账号登录", signIn: "/teacher-login" }, { status: 401 });
  if (!can(access, permission)) return Response.json({ error: "当前角色没有执行此操作的权限" }, { status: 403 });
  return access;
}

export function isDenied(value: AccessContext | Response): value is Response {
  return value instanceof Response;
}

/** 班级数据属于教师工作区；助教必须被教师逐班授权。 */
export async function hasClassAccess(access: AccessContext, classId: number) {
  if (!Number.isFinite(classId) || classId <= 0) return false;
  if (access.role === "teacher") {
    const row = await env.DB.prepare("SELECT owner_id AS ownerId FROM classes WHERE id=?").bind(classId).first<{ ownerId: number | null }>();
    // 兼容第一版已存在、尚未写入 owner_id 的个人工作区数据。
    if (!row) return false;
    return row.ownerId == null || Number(row.ownerId) === access.id;
  }
  if (access.role === "assistant") {
    const row = await env.DB.prepare("SELECT 1 AS allowed FROM staff_class_access WHERE user_id=? AND class_id=?").bind(access.id, classId).first();
    return Boolean(row);
  }
  return false;
}

export async function requireClassAccess(access: AccessContext, classId: number) {
  if (await hasClassAccess(access, classId)) return null;
  return Response.json({ error: "当前账号未获授权访问该班级" }, { status: 403 });
}

/** 助教只能读取其获授权班级中的学生；学生和家长通过门户读取本人数据。 */
export async function hasStudentAccess(access: AccessContext, studentId: number) {
  if (!Number.isFinite(studentId) || studentId <= 0) return false;
  if (access.role === "teacher") return Boolean(await env.DB.prepare("SELECT 1 AS allowed FROM students WHERE id=?").bind(studentId).first());
  if (access.role === "assistant") return Boolean(await env.DB.prepare("SELECT 1 AS allowed FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE e.student_id=? AND e.status='active' AND sca.user_id=? LIMIT 1").bind(studentId, access.id).first());
  return false;
}

export async function requireStudentAccess(access: AccessContext, studentId: number) {
  if (await hasStudentAccess(access, studentId)) return null;
  return Response.json({ error: "当前账号未获授权访问该学生" }, { status: 403 });
}

export async function hasLessonAccess(access: AccessContext, lessonId: number) {
  const lesson = await env.DB.prepare("SELECT class_id AS classId FROM lessons WHERE id=?").bind(lessonId).first<{ classId: number | null }>();
  if (!lesson) return false;
  if (access.role === "teacher") return true;
  return lesson.classId != null && hasClassAccess(access, Number(lesson.classId));
}

export async function requireLessonAccess(access: AccessContext, lessonId: number) {
  if (await hasLessonAccess(access, lessonId)) return null;
  return Response.json({ error: "当前账号未获授权访问该课时" }, { status: 403 });
}

export async function hasFeedbackAccess(access: AccessContext, feedbackId: number) {
  if (!Number.isFinite(feedbackId) || feedbackId <= 0) return false;
  if (access.role === "teacher") return Boolean(await env.DB.prepare("SELECT 1 AS allowed FROM feedback WHERE id=?").bind(feedbackId).first());
  if (access.role === "assistant") return Boolean(await env.DB.prepare("SELECT 1 AS allowed FROM feedback f LEFT JOIN lessons l ON l.id=f.lesson_id JOIN staff_class_access sca ON sca.class_id=COALESCE(f.class_id,l.class_id) WHERE f.id=? AND sca.user_id=?").bind(feedbackId, access.id).first());
  return false;
}

export async function requireFeedbackAccess(access: AccessContext, feedbackId: number) {
  if (await hasFeedbackAccess(access, feedbackId)) return null;
  return Response.json({ error: "当前账号未获授权访问该反馈" }, { status: 403 });
}

export async function audit(access: AccessContext, action: string, entityType: string, entityId?: string | number | null, detail?: Record<string, unknown>) {
  await env.DB.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)").bind(access.id, action, entityType, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null).run();
}

export const roleName: Record<RoleCode, string> = { teacher: "教师", assistant: "助教", student: "学生", parent: "家长" };
