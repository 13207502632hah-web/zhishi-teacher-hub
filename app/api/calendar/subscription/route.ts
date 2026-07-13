import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function GET() { const access = await requirePermission("lessons:read"); if (isDenied(access)) return access; const row = await env.DB.prepare("SELECT id,label,reminder_minutes AS reminderMinutes,created_at AS createdAt FROM calendar_subscriptions WHERE revoked_at IS NULL ORDER BY id DESC LIMIT 1").first(); return Response.json({ subscription: row }); }
export async function POST() { const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; await env.DB.prepare("UPDATE calendar_subscriptions SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL").run(); const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), hash = await tokenHash(token); await env.DB.prepare("INSERT INTO calendar_subscriptions(token_hash,label,reminder_minutes) VALUES(?,?,?)").bind(hash, "Apple 日历", 30).run(); await audit(access, "rotate", "calendar_subscription"); return Response.json({ token, path: `/api/calendar/feed/${token}` }); }
async function tokenHash(token: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }

