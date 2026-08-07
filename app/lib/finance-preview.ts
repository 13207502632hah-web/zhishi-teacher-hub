import { env } from "cloudflare:workers";

export const PREVIEW_TTL_MS = 5 * 60 * 1000;
const encoder = new TextEncoder();

export type Row = Record<string, any>;

export type PreviewPayload = {
  v: 1;
  exp: number;
  actorId: number;
  lessonId: number;
  payerType: "institution" | "parent";
  payerId: number | null;
  adjustment: number;
  adjustmentReason: string;
  fingerprint: string;
  operationId: string;
};

const toBase64Url = (value: Uint8Array) => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const fromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const constantTimeEqual = (left: string, right: string) => {
  const a = encoder.encode(left), b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

async function signPreview(value: string) {
  const secret = env.TEACHER_ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function previewFingerprint(input: { lessonId: number; lessonDate: string; payerType: string; payerId: number | null; ruleId?: number | null; calculation: Record<string, any> }) {
  const canonical = JSON.stringify({
    lessonId: input.lessonId,
    lessonDate: input.lessonDate,
    payerType: input.payerType,
    payerId: input.payerId,
    ruleId: input.ruleId || null,
    baseFee: input.calculation.baseFee,
    adjustment: input.calculation.adjustment,
    expectedAmount: input.calculation.expectedAmount,
    items: (input.calculation.items || []).map((item: Row) => ({ studentId: item.studentId, status: item.status, factor: item.factor, unitFee: item.unitFee, amount: item.amount, reason: item.reason || null })),
  });
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonical))));
}

export async function createPreviewToken(payload: Omit<PreviewPayload, "v" | "exp">) {
  const exp = Date.now() + PREVIEW_TTL_MS;
  const encoded = toBase64Url(encoder.encode(JSON.stringify({ v: 1, exp, ...payload })));
  const signature = await signPreview(encoded);
  if (!signature) return null;
  return { token: `${encoded}.${signature}`, expiresAt: new Date(exp).toISOString() };
}

export async function readPreviewToken(token: unknown): Promise<PreviewPayload | null> {
  if (typeof token !== "string") return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = await signPreview(encoded);
  if (!expected || !constantTimeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as PreviewPayload;
    if (payload.v !== 1 || !Number.isFinite(payload.exp) || payload.exp <= Date.now() || !Number.isInteger(payload.actorId) || !Number.isInteger(payload.lessonId) || !Number.isFinite(payload.adjustment) || typeof payload.fingerprint !== "string" || typeof payload.operationId !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
