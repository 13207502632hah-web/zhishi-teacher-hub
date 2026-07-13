import { env } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../../lib/access";
import { saveReview } from "../../../../lib/services/review-service";

async function assignmentAccess(id: number, access: Awaited<ReturnType<typeof requirePermission>>) {
  if (isDenied(access)) return access;
  const row = await env.DB.prepare("SELECT class_id AS classId FROM assignments WHERE id=?").bind(id).first<{ classId: number | null }>();
  if (!row) return Response.json({ error: "作业不存在" }, { status: 404 });
  if (row.classId) return requireClassAccess(access, Number(row.classId));
  return access.role === "teacher" ? null : Response.json({ error: "当前账号无权访问指定学生作业" }, { status: 403 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const assignmentId = Number((await context.params).id), denied = await assignmentAccess(assignmentId, access); if (denied) return denied;
  const rows = await env.DB.prepare("SELECT s.id,s.student_id AS studentId,st.name AS studentName,s.status,s.score,s.review_tags AS reviewTags,s.teacher_note AS teacherNote,s.submitted_at AS submittedAt,(SELECT MAX(version) FROM submission_versions WHERE submission_id=s.id) AS latestVersion,(SELECT text_content FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS textContent FROM assignment_submissions s JOIN students st ON st.id=s.student_id WHERE s.assignment_id=? ORDER BY st.name").bind(assignmentId).all();
  return Response.json({ submissions: rows.results });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const assignmentId = Number((await context.params).id), denied = await assignmentAccess(assignmentId, access); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>;
  const belongs = await env.DB.prepare("SELECT 1 FROM assignment_submissions WHERE id=? AND assignment_id=?").bind(Number(body.submissionId), assignmentId).first();
  if (!belongs) return Response.json({ error: "提交记录不属于当前作业" }, { status: 400 });
  const response = await saveReview(body, { actor: { type: "user", id: access.id }, userId: access.id });
  if (response.ok) await audit(access, String(body.action || "save-review"), "assignment_submission", String(body.submissionId), { assignmentId });
  return response;
}
