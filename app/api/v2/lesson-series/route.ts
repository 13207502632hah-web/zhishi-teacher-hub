import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";
import { commitWeeklySchedule, listWeeklySchedules, planWeeklySchedule, ScheduleError } from "../../../lib/services/weekly-schedule-service";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  return Response.json(await listWeeklySchedules(env.DB, access, new URL(request.url).searchParams.get("seriesId") || ""));
}
export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.mode === "preview") {
      const plan = await planWeeklySchedule(env.DB, access, body);
      return Response.json({ token: plan.token, slots: plan.slots, before: plan.before.map((row) => ({ id: row.id, date: row.date, startTime: row.start_time, endTime: row.end_time })), skipped: plan.skipped, conflicts: plan.conflicts });
    }
    if (body.mode !== "commit") return Response.json({ error: "请先预览课表" }, { status: 400 });
    return Response.json(await commitWeeklySchedule(env.DB, access, body));
  } catch (error) {
    if (error instanceof ScheduleError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "请求内容无效" }, { status: 400 });
    console.error("weekly schedule failed", error);
    return Response.json({ error: "课表暂时无法保存，请保留页面后重试" }, { status: 500 });
  }
}
