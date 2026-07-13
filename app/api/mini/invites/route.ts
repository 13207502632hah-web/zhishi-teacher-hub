import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission, requireStudentAccess } from "../../../lib/access";
import { miniTokenHash } from "../../../lib/mini-auth";
import { listBindingRequests } from "../../../lib/services/mini-binding-service";

export async function GET() {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  return Response.json({ bindings: await listBindingRequests() });
}

export async function POST(request: Request) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, role = body.role === "parent" ? "parent" : "student", studentId = Number(body.studentId);
  if (!studentId) return Response.json({ error: "请选择学生" }, { status: 400 });
  const denied = await requireStudentAccess(access, studentId); if (denied) return denied;
  const bytes = crypto.getRandomValues(new Uint32Array(1)), code = String(100000 + (bytes[0] % 900000));
  const hash = await miniTokenHash(code), expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO mini_invites(code_hash,role,student_id,expires_at,created_by) VALUES(?,?,?,?,?)").bind(hash, role, studentId, expiresAt, access.id).run();
  await audit(access, "create", "mini_invite", studentId, { role, expiresAt });
  return Response.json({ code, role, studentId, expiresAt });
}
