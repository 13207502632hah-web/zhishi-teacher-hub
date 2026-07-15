import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { ensurePromotionRun } from "../../../../lib/services/grade-promotion-service";

const yearFrom = async (context: { params: Promise<{ year: string }> }) => decodeURIComponent((await context.params).year);
export async function GET(_: Request, context: { params: Promise<{ year: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const year = await yearFrom(context), run = await ensurePromotionRun(env.DB, year), items = await env.DB.prepare("SELECT gpi.id,gpi.student_id AS studentId,gpi.from_grade AS fromGrade,gpi.to_grade AS toGrade,gpi.action,gpi.status,gpi.reason,s.name,s.school,s.status AS studentStatus FROM grade_promotion_items gpi JOIN students s ON s.id=gpi.student_id WHERE gpi.run_id=? ORDER BY gpi.from_grade,s.name").bind(run?.id).all();
  return Response.json({ run, items: items.results, reminder: "晋升建议不会自动修改学生，排除留级、转学或暂缓学生后再确认。" });
}
export async function POST(request: Request, context: { params: Promise<{ year: string }> }) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const year = await yearFrom(context), run = await ensurePromotionRun(env.DB, year);
  if (run?.status === "confirmed") return Response.json({ ok: true, repeated: true, runId: run.id });
  const body = await request.json().catch(() => ({})) as { excludedStudentIds?: number[] }, excluded = new Set((body.excludedStudentIds || []).map(Number));
  const items = (await env.DB.prepare("SELECT * FROM grade_promotion_items WHERE run_id=?").bind(run?.id).all<Record<string, unknown>>()).results;
  const changes = [];
  for (const item of items) {
    if (excluded.has(Number(item.student_id))) { changes.push(env.DB.prepare("UPDATE grade_promotion_items SET status='excluded',reason='教师本次排除',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id)); continue; }
    changes.push(env.DB.prepare("UPDATE students SET grade=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND grade=?").bind(item.to_grade, item.student_id, item.from_grade));
    changes.push(env.DB.prepare("UPDATE grade_promotion_items SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id));
  }
  if (changes.length) await env.DB.batch(changes);
  await env.DB.prepare("UPDATE grade_promotion_runs SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(access.id, run?.id).run();
  await audit(access, "confirm", "grade_promotion_run", Number(run?.id), { academicYear: year, excluded: [...excluded] });
  return Response.json({ ok: true, runId: run?.id, confirmed: items.length - excluded.size, excluded: excluded.size });
}
