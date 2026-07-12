import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordStrengthError, safeReturnPath } from "./teacher-auth-policy";

export { passwordStrengthError, safeReturnPath } from "./teacher-auth-policy";

const SESSION_COOKIE = "zhishi_teacher_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const PASSWORD_ITERATIONS = 210_000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

type SessionPayload = { exp: number; sv: number; v: 2 };
type CredentialRow = { passwordHash: string; passwordSalt: string; iterations: number; sessionVersion: number };

export async function verifyTeacherAdminCredentials(account: string, password: string) {
  const configuredAccount = env.TEACHER_ADMIN_ACCOUNT;
  const configuredPassword = env.TEACHER_ADMIN_PASSWORD;
  if (!configuredAccount || !configuredPassword || !account || !password) return false;

  const [actualAccount, expectedAccount] = await Promise.all([digest(account.trim()), digest(configuredAccount.trim())]);
  if (!constantTimeEqual(actualAccount, expectedAccount)) return false;
  const stored = await readCredential();
  if (stored) return constantTimeEqual(await derivePassword(password, stored.passwordSalt, stored.iterations), stored.passwordHash);
  return constantTimeEqual(await digest(password), await digest(configuredPassword));
}

export async function getTeacherAdminSession() {
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const cookieHeader = (await headers()).get("cookie") || "";
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  const expected = await sign(encodedPayload, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(decodeText(fromBase64Url(encodedPayload))) as SessionPayload;
    if (payload.v !== 2 || !Number.isFinite(payload.exp) || payload.exp <= Date.now() || !Number.isInteger(payload.sv)) return null;
    return payload.sv === await currentSessionVersion() ? payload : null;
  } catch {
    return null;
  }
}

export async function createTeacherAdminSessionCookie() {
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("教师管理员会话密钥尚未配置");
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 2, sv: await currentSessionVersion(), exp: Date.now() + SESSION_TTL_SECONDS * 1000 } satisfies SessionPayload)));
  const signature = await sign(payload, secret);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export async function changeTeacherAdminPassword(currentPassword: string, newPassword: string) {
  const account = env.TEACHER_ADMIN_ACCOUNT;
  if (!account || !await verifyTeacherAdminCredentials(account, currentPassword)) return { ok: false as const, error: "当前密码不正确" };
  const strengthError = passwordStrengthError(newPassword);
  if (strengthError) return { ok: false as const, error: strengthError };
  if (constantTimeEqual(await digest(currentPassword), await digest(newPassword))) return { ok: false as const, error: "新密码不能与当前密码相同" };
  const salt = toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const hash = await derivePassword(newPassword, salt, PASSWORD_ITERATIONS);
  const existing = await readCredential();
  const nextVersion = (existing?.sessionVersion || 1) + 1;
  await env.DB.prepare("INSERT INTO teacher_admin_credentials(id,password_salt,password_hash,iterations,session_version,updated_at) VALUES(1,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,iterations=excluded.iterations,session_version=excluded.session_version,updated_at=CURRENT_TIMESTAMP").bind(salt, hash, PASSWORD_ITERATIONS, nextVersion).run();
  return { ok: true as const };
}

export async function loginAttemptStatus(key: string) {
  const row = await env.DB.prepare("SELECT failures,blocked_until AS blockedUntil FROM teacher_login_attempts WHERE key=?").bind(key).first<{ failures: number; blockedUntil: number | null }>();
  if (!row?.blockedUntil || Number(row.blockedUntil) <= Date.now()) return { blocked: false, retryAfterSeconds: 0 };
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((Number(row.blockedUntil) - Date.now()) / 1000)) };
}

export async function recordLoginFailure(key: string) {
  const row = await env.DB.prepare("SELECT failures,blocked_until AS blockedUntil FROM teacher_login_attempts WHERE key=?").bind(key).first<{ failures: number; blockedUntil: number | null }>();
  const failures = Number(row?.failures || 0) + 1;
  const blockedUntil = failures >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_BLOCK_MS : null;
  await env.DB.prepare("INSERT INTO teacher_login_attempts(key,failures,blocked_until,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=CURRENT_TIMESTAMP").bind(key, failures, blockedUntil).run();
}

export async function clearLoginFailures(key: string) {
  await env.DB.prepare("DELETE FROM teacher_login_attempts WHERE key=?").bind(key).run();
}

export function clearTeacherAdminSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function requireTeacherAdmin(returnTo: string) {
  if (await getTeacherAdminSession()) return;
  redirect(teacherAdminSignInPath(returnTo));
}

export function teacherAdminSignInPath(returnTo: string) {
  return `/teacher-login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function readCredential() {
  return env.DB.prepare("SELECT password_salt AS passwordSalt,password_hash AS passwordHash,iterations,session_version AS sessionVersion FROM teacher_admin_credentials WHERE id=1").first<CredentialRow>();
}

async function currentSessionVersion() {
  return Number((await readCredential())?.sessionVersion || 1);
}

async function derivePassword(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64Url(salt), iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function constantTimeEqual(left: Uint8Array | string, right: Uint8Array | string) {
  const a = typeof left === "string" ? encoder.encode(left) : left;
  const b = typeof right === "string" ? encoder.encode(right) : right;
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function readCookie(value: string, name: string) {
  return value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function toBase64Url(value: Uint8Array) {
  let text = "";
  for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function decodeText(value: Uint8Array) {
  return new TextDecoder().decode(value);
}
