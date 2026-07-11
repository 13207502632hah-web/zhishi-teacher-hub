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

export async function audit(access: AccessContext, action: string, entityType: string, entityId?: string | number | null, detail?: Record<string, unknown>) {
  await env.DB.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,?,?,?,?)").bind(access.id, action, entityType, entityId == null ? null : String(entityId), detail ? JSON.stringify(detail) : null).run();
}

export const roleName: Record<RoleCode, string> = { teacher: "教师", assistant: "助教", student: "学生", parent: "家长" };
