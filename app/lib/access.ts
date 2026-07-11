import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../chatgpt-auth";

export type RoleCode = "teacher" | "assistant" | "student" | "parent";
export type AccessContext = { id: number; name: string; email: string; roles: RoleCode[]; role: RoleCode };

const permissions: Record<RoleCode, string[]> = {
  teacher: ["*"],
  assistant: ["dashboard:read", "classes:read", "students:read", "lessons:read", "lessons:write", "questions:read", "questions:write", "papers:read", "papers:write", "feedback:read", "feedback:write", "resources:read", "resources:private", "resources:write"],
  student: ["portal:read", "resources:read"],
  parent: ["portal:read", "resources:read"],
};
const rank: RoleCode[] = ["teacher", "assistant", "parent", "student"];

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
  const identity = await getChatGPTUser();
  if (!identity) return null;
  await seedRoles();
  const email = identity.email.trim().toLowerCase(), db = env.DB;
  let user = await db.prepare("SELECT id,name,email,status FROM users WHERE lower(email)=?").bind(email).first<Record<string, unknown>>();
  if (!user) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
    if (Number(count?.total || 0) > 0) return null;
    await db.prepare("INSERT INTO users(name,email,status) SELECT ?,?,'active' WHERE NOT EXISTS (SELECT 1 FROM users)").bind(identity.fullName || identity.displayName, email).run();
    user = await db.prepare("SELECT id,name,email,status FROM users WHERE lower(email)=?").bind(email).first<Record<string, unknown>>();
    if (!user) return null;
    const teacher = await db.prepare("SELECT id FROM roles WHERE code='teacher'").first<{ id: number }>();
    await db.prepare("INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)").bind(user?.id, teacher?.id).run();
  }
  if (user?.status !== "active") return null;
  const result = await db.prepare("SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?").bind(user.id).all<{ code: RoleCode }>();
  const roles = result.results.map((row) => row.code).filter((code): code is RoleCode => rank.includes(code));
  if (!roles.length) return null;
  const role = rank.find((code) => roles.includes(code)) || "student";
  return { id: Number(user.id), name: String(user.name), email: String(user.email), roles, role };
}

export function can(access: AccessContext, permission: string) {
  return permissions[access.role].includes("*") || permissions[access.role].includes(permission);
}

export async function requirePermission(permission: string): Promise<AccessContext | Response> {
  const access = await getAccess();
  if (!access) return Response.json({ error: "请先登录，或请教师在设置中添加您的账号", signIn: "/signin-with-chatgpt" }, { status: 401 });
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
