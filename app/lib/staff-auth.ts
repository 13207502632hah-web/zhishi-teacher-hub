import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { passwordStrengthError } from "./teacher-auth-policy";

const SESSION_COOKIE = "zhishi_staff";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 210_000;
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

type SessionPayload = { v: 1; uid: number; sv: number; exp: number };
type Credential = { userId: number; name: string; email: string; role: "teacher" | "assistant"; passwordSalt: string; passwordHash: string; iterations: number; sessionVersion: number };

export async function verifyStaffCredentials(account: string, password: string) {
  if (!account || !password) return null;
  const credential = await env.DB.prepare(`SELECT u.id AS userId,u.name,u.email,r.code AS role,c.password_salt AS passwordSalt,c.password_hash AS passwordHash,c.iterations,c.session_version AS sessionVersion
    FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN staff_credentials c ON c.user_id=u.id
    WHERE lower(u.email)=lower(?) AND u.status='active' AND r.code IN ('teacher','assistant') LIMIT 1`).bind(account.trim()).first<Credential>();
  if (!credential) return null;
  const derived = await derivePassword(password, credential.passwordSalt, Number(credential.iterations));
  return constantTimeEqual(derived, credential.passwordHash) ? credential : null;
}

export async function getStaffSession() {
  const secret = String(env.TEACHER_ADMIN_SESSION_SECRET || "");
  if (!secret) return null;
  const cookie = readCookie((await headers()).get("cookie") || "", SESSION_COOKIE);
  if (!cookie) return null;
  const [encoded, signature, extra] = cookie.split(".");
  if (!encoded || !signature || extra || !constantTimeEqual(signature, await sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (payload.v !== 1 || !Number.isInteger(payload.uid) || payload.uid <= 0 || !Number.isInteger(payload.sv) || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    const current = await env.DB.prepare("SELECT c.session_version AS sessionVersion FROM staff_credentials c JOIN users u ON u.id=c.user_id WHERE c.user_id=? AND u.status='active'").bind(payload.uid).first<{ sessionVersion: number }>();
    return current && Number(current.sessionVersion) === payload.sv ? { userId: payload.uid, sessionVersion: payload.sv } : null;
  } catch { return null; }
}

export async function createStaffSessionCookie(userId: number) {
  const secret = String(env.TEACHER_ADMIN_SESSION_SECRET || "");
  if (!secret) throw new Error("工作室会话密钥尚未配置");
  const row = await env.DB.prepare("SELECT session_version AS sessionVersion FROM staff_credentials WHERE user_id=?").bind(userId).first<{ sessionVersion: number }>();
  if (!row) throw new Error("助教登录凭据不存在");
  const encoded = toBase64Url(encoder.encode(JSON.stringify({ v: 1, uid: userId, sv: Number(row.sessionVersion), exp: Date.now() + SESSION_TTL_SECONDS * 1000 } satisfies SessionPayload)));
  return `${SESSION_COOKIE}=${encoded}.${await sign(encoded, secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearStaffSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function setStaffPassword(userId: number, password: string) {
  const strengthError = passwordStrengthError(password);
  if (strengthError) return { ok: false as const, error: strengthError };
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(18))), hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  await env.DB.prepare(`INSERT INTO staff_credentials(user_id,password_salt,password_hash,iterations,session_version) VALUES(?,?,?,?,1)
    ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,iterations=excluded.iterations,session_version=staff_credentials.session_version+1,updated_at=CURRENT_TIMESTAMP`)
    .bind(userId, salt, hash, PASSWORD_ITERATIONS).run();
  return { ok: true as const };
}

export async function changeStaffPassword(userId: number, currentPassword: string, newPassword: string) {
  const row = await env.DB.prepare("SELECT u.email FROM users u JOIN staff_credentials c ON c.user_id=u.id WHERE u.id=? AND u.status='active'").bind(userId).first<{ email: string }>();
  if (!row || !(await verifyStaffCredentials(row.email, currentPassword))) return { ok: false as const, error: "当前密码不正确" };
  const currentHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(currentPassword))), nextHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(newPassword)));
  if (constantTimeEqual(currentHash, nextHash)) return { ok: false as const, error: "新密码不能与当前密码相同" };
  return setStaffPassword(userId, newPassword);
}

export async function revokeStaffSessions(userId: number) {
  await env.DB.prepare("UPDATE staff_credentials SET session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(userId).run();
}

export async function staffLoginAttemptStatus(key: string) {
  const row = await env.DB.prepare("SELECT failures,blocked_until AS blockedUntil FROM staff_login_attempts WHERE key=?").bind(key).first<{ failures: number; blockedUntil: number | null }>();
  return row?.blockedUntil && Number(row.blockedUntil) > Date.now() ? { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((Number(row.blockedUntil) - Date.now()) / 1000)) } : { blocked: false, retryAfterSeconds: 0 };
}

export async function recordStaffLoginFailure(key: string) {
  const row = await env.DB.prepare("SELECT failures FROM staff_login_attempts WHERE key=?").bind(key).first<{ failures: number }>(), failures = Number(row?.failures || 0) + 1, blockedUntil = failures >= MAX_FAILURES ? Date.now() + BLOCK_MS : null;
  await env.DB.prepare("INSERT INTO staff_login_attempts(key,failures,blocked_until,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(key, failures, blockedUntil).run();
}

export async function clearStaffLoginFailures(key: string) {
  await env.DB.prepare("DELETE FROM staff_login_attempts WHERE key=?").bind(key).run();
}

async function derivePassword(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}
async function sign(value: string, secret: string) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))); }
function constantTimeEqual(left: Uint8Array | string, right: Uint8Array | string) { const a = typeof left === "string" ? encoder.encode(left) : left, b = typeof right === "string" ? encoder.encode(right) : right; if (a.length !== b.length) return false; let difference = 0; for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]; return difference === 0; }
function readCookie(value: string, name: string) { return value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null; }
function toBase64Url(value: Uint8Array) { let text = ""; for (const byte of value) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); }
function fromBase64Url(value: string) { const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); }
