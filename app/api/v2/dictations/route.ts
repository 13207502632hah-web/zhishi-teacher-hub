import { audit, isDenied, requireClassAccess, requirePermission, requireStudentAccess } from "../../../lib/access";
import { createAssignment, listAssignments, type AssignmentInput } from "../../../lib/services/assignment-service";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read");
  if (isDenied(access)) return access;
  const filters = new URL(request.url).searchParams;
  filters.set("kind", "dictation");
  return Response.json(await listAssignments({ kind: "website", access }, filters));
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write");
  if (isDenied(access)) return access;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const classId = Number(body.classId || 0);
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(Number).filter(Boolean) : [];
  if (access.role === "assistant" && !classId) return Response.json({ error: "助教创建听写任务必须关联已授权班级" }, { status: 400 });
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  for (const studentId of studentIds) { const denied = await requireStudentAccess(access, studentId); if (denied) return denied; }
  const mode = body.mode === "follow_reading" ? "follow_reading" : "dictation";
  const response = await createAssignment({ kind: "website", access }, { ...body, classId: classId || null, studentIds, kind: mode, status: "draft" } as AssignmentInput);
  if (response.ok) {
    const result = await response.clone().json() as Record<string, unknown>;
    await audit(access, "create", "dictation", String(result.id), { mode, status: "draft", recipientCount: result.recipientCount });
  }
  return response;
}
