import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../../lib/access";

export async function GET() {
  const access = await requirePermission("dashboard:read"); if (isDenied(access)) return access;
  const today = new Date().toISOString().slice(0, 10);
  const [lessons, approvals, records] = await Promise.all([
    env.DB.prepare("SELECT l.id,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.topic,l.status,l.class_id AS classId,c.name AS className FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=? AND l.status!='cancelled' ORDER BY l.start_time").bind(today).all(),
    env.DB.prepare("SELECT count(*) AS total FROM v2_approvals WHERE user_id=? AND state='pending'").bind(access.id).first<{ total: number }>(),
    env.DB.prepare("SELECT count(*) AS total FROM v2_mobile_records WHERE user_id=? AND deleted_at IS NULL AND date(occurred_at)=?").bind(access.id, today).first<{ total: number }>(),
  ]);
  return Response.json({ date: today, lessons: lessons.results, pendingApprovals: Number(approvals?.total || 0), recordsToday: Number(records?.total || 0) }, { headers: { "Cache-Control": "private, no-store" } });
}
