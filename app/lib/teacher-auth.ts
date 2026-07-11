import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "zhishi_teacher_admin";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

type SessionPayload = { exp: number; v: 1 };

export async function verifyTeacherAdminCredentials(account: string, password: string) {
  const configuredAccount = env.TEACHER_ADMIN_ACCOUNT;
  const configuredPassword = env.TEACHER_ADMIN_PASSWORD;
  if (!configuredAccount || !configuredPassword || !account || !password) return false;

  const [actualAccount, expectedAccount, actualPassword, expectedPassword] = await Promise.all([
    digest(account.trim()), digest(configuredAccount.trim()), digest(password), digest(configuredPassword),
  ]);
  return constantTimeEqual(actualAccount, expectedAccount) && constantTimeEqual(actualPassword, expectedPassword);
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
    return payload.v === 1 && Number.isFinite(payload.exp) && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export async function createTeacherAdminSessionCookie() {
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("教师管理员会话密钥尚未配置");
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 1, exp: Date.now() + SESSION_TTL_SECONDS * 1000 } satisfies SessionPayload)));
  const signature = await sign(payload, secret);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
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

export function safeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/workspace";
  try {
    const url = new URL(value, "https://teacher.local");
    return url.origin === "https://teacher.local" && !url.pathname.startsWith("/api/auth/") && url.pathname !== "/teacher-login"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/workspace";
  } catch {
    return "/workspace";
  }
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
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
