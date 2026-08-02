import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import type { MiniAccess } from "./mini-auth";

const PORTAL_COOKIE = "zhishi_portal_session";
const PORTAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const encoder = new TextEncoder();

type PortalRole = "student" | "parent";
type PortalCookiePayload = { v: 1; sid: string; exp: number };

export type PortalSession = {
  accountId: number;
  userId: number | null;
  name: string;
  role: PortalRole;
  sessionId: string;
  expiresAt: string;
};

export async function getPortalAccess(): Promise<PortalSession | null> {
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const cookieHeader = (await headers()).get("cookie") || "";
  const token = readCookie(cookieHeader, PORTAL_COOKIE);
  if (!token) return null;

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  const expected = await sign(`portal-session:${encodedPayload}`, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  let payload: PortalCookiePayload;
  try {
    payload = JSON.parse(decodeText(fromBase64Url(encodedPayload))) as PortalCookiePayload;
  } catch {
    return null;
  }
  if (payload.v !== 1 || !payload.sid || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;

  const row = await env.DB.prepare("SELECT wa.id AS accountId,wa.user_id AS userId,wa.display_name AS name,wa.role,ms.id AS sessionId,ms.expires_at AS expiresAt FROM mini_sessions ms JOIN wechat_accounts wa ON wa.id=ms.account_id WHERE ms.id=? AND ms.expires_at>CURRENT_TIMESTAMP AND wa.status='active' AND wa.role IN ('student','parent')")
    .bind(payload.sid).first<Record<string, unknown>>();
  if (!row || (row.role !== "student" && row.role !== "parent")) return null;
  return {
    accountId: Number(row.accountId),
    userId: row.userId == null ? null : Number(row.userId),
    name: String(row.name || (row.role === "parent" ? "家长" : "学生")),
    role: row.role,
    sessionId: String(row.sessionId),
    expiresAt: String(row.expiresAt),
  };
}

export async function createPortalSessionCookie(access: MiniAccess) {
  if (access.role !== "student" && access.role !== "parent") throw new Error("只有学生或家长会话可以进入学习门户");
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("门户会话密钥尚未配置");
  const sourceExpiry = new Date(access.expiresAt).valueOf();
  if (!Number.isFinite(sourceExpiry) || sourceExpiry <= Date.now()) throw new Error("小程序登录已过期，请重新登录");
  const expiresAt = Math.min(sourceExpiry, Date.now() + PORTAL_SESSION_TTL_MS);
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 1, sid: access.sessionId, exp: expiresAt } satisfies PortalCookiePayload)));
  const signature = await sign(`portal-session:${payload}`, secret);
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  return `${PORTAL_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearPortalSessionCookie() {
  return `${PORTAL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function constantTimeEqual(left: string, right: string) {
  const a = encoder.encode(left), b = encoder.encode(right);
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
