import { audit, isDenied, requireClassAccess, requirePermission, requireStudentAccess } from "../../lib/access";
import { createAssignment, listAssignments, type AssignmentInput } from "../../lib/services/assignment-service";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  return Response.json(await listAssignments({ kind: "website", access }, new URL(request.url).searchParams));
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, any>;
  if (access.role === "assistant" && !body.classId) return Response.json({ error: "助教创建作业必须关联已授权班级" }, { status: 400 });
  if (body.classId) { const denied = await requireClassAccess(access, Number(body.classId)); if (denied) return denied; }
  for (const studentId of Array.isArray(body.studentIds) ? body.studentIds : []) { const denied = await requireStudentAccess(access, Number(studentId)); if (denied) return denied; }
  const response = await createAssignment({ kind: "website", access }, body as AssignmentInput);
  if (response.ok) { const result = await response.clone().json() as Record<string, unknown>; await audit(access, "create", "assignment", String(result.id), { status: result.status, recipientCount: result.recipientCount }); }
  return response;
}
