import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission, requireStudentAccess } from "../../../../lib/access";
import { calculateMastery } from "../../../../lib/mastery";

type Aggregate = { average?: number | null; total?: number | null; completed?: number | null; mastered?: number | null };

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

async function masteryFor(studentId: number) {
  const [assessment, homework, understanding, wrong, history] = await Promise.all([
    env.DB.prepare("SELECT AVG(score) AS average FROM assessment_results WHERE student_id=? AND score IS NOT NULL").bind(studentId).first<Aggregate>(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed FROM assignment_submissions WHERE student_id=?").bind(studentId).first<Aggregate>(),
    env.DB.prepare("SELECT AVG(understanding) AS average FROM student_lesson_records WHERE student_id=? AND understanding IS NOT NULL").bind(studentId).first<Aggregate>(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='mastered' THEN 1 ELSE 0 END) AS mastered FROM wrong_questions WHERE student_id=?").bind(studentId).first<Aggregate>(),
    env.DB.prepare("SELECT id,calculated_score AS calculatedScore,override_score AS overrideScore,reason,created_by AS createdBy,created_at AS createdAt FROM student_mastery_adjustments WHERE student_id=? ORDER BY id DESC LIMIT 20").bind(studentId).all(),
  ]);
  const calculated = calculateMastery({
    assessmentAverage: assessment?.average == null ? null : Number(assessment.average),
    homeworkCompletionRate: Number(homework?.total || 0) ? Number(homework?.completed || 0) / Number(homework?.total) : null,
    understandingAverage: understanding?.average == null ? null : Number(understanding.average),
    wrongQuestionMasteryRate: Number(wrong?.total || 0) ? Number(wrong?.mastered || 0) / Number(wrong?.total) : null,
  });
  const latest = history.results[0] as Record<string, unknown> | undefined;
  return { ...calculated, effectiveScore: latest ? Number(latest.overrideScore) : calculated.score, manualAdjustment: latest || null, adjustmentHistory: history.results };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireStudentAccess(access, id); if (denied) return denied;
  return Response.json({ mastery: await masteryFor(id) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const id = await idFrom(context), denied = await requireStudentAccess(access, id); if (denied) return denied;
  const body = await request.json() as { score?: number; reason?: string }, score = Number(body.score), reason = String(body.reason || "").trim();
  if (!Number.isFinite(score) || score < 0 || score > 100) return Response.json({ error: "掌握度必须是 0 至 100 的整数" }, { status: 400 });
  if (reason.length < 4) return Response.json({ error: "请填写至少 4 个字的修正依据" }, { status: 400 });
  const current = await masteryFor(id);
  const row = await env.DB.prepare("INSERT INTO student_mastery_adjustments(student_id,calculated_score,override_score,reason,created_by) VALUES(?,?,?,?,?) RETURNING id").bind(id, current.score, Math.round(score), reason, access.name).first();
  await audit(access, "adjust_mastery", "student", id, { calculatedScore: current.score, overrideScore: Math.round(score), reason });
  return Response.json({ adjustment: row, mastery: await masteryFor(id) }, { status: 201 });
}
