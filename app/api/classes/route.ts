import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { classes } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";

const value = (input: unknown) => String(input || "").trim();

export async function GET(request: Request) {
  const access = await requirePermission("classes:read"); if (isDenied(access)) return access;
  const selected = new URL(request.url).searchParams.get("status") || "active", statuses = selected === "all" ? [] : [selected === "archived" ? "archived" : "active"];
  const where: string[] = [], bind: unknown[] = [];
  if (access.role === "teacher") { where.push("(c.owner_id IS NULL OR c.owner_id=?)"); bind.push(access.id); }
  if (access.role === "assistant") { where.push("EXISTS (SELECT 1 FROM staff_class_access sca WHERE sca.class_id=c.id AND sca.user_id=?)"); bind.push(access.id); }
  if (statuses.length) { where.push("c.status=?"); bind.push(statuses[0]); }
  const sql = `SELECT c.id,c.owner_id AS ownerId,c.name,c.stage,c.grade,c.course_type AS courseType,c.start_date AS startDate,c.schedule,c.notes,c.status,c.created_at AS createdAt,c.updated_at AS updatedAt, (SELECT COUNT(*) FROM enrollments e WHERE e.class_id=c.id AND e.status='active') AS studentCount, (SELECT COUNT(*) FROM lessons l WHERE l.class_id=c.id) AS lessonCount, (SELECT COUNT(DISTINCT slr.student_id) FROM student_lesson_records slr JOIN lessons l ON l.id=slr.lesson_id WHERE l.class_id=c.id AND slr.risk_confirmed=1) AS riskCount FROM classes c ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END,c.updated_at DESC`;
  const rows = await env.DB.prepare(sql).bind(...bind).all();
  return Response.json({ classes: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("classes:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, name = value(payload.name), stage = value(payload.stage), grade = value(payload.grade);
  if (!name || !stage || !grade) return Response.json({ error: "班级名称、学段、年级为必填项" }, { status: 400 });
  if (name.length > 80) return Response.json({ error: "班级名称不超过 80 个字符" }, { status: 400 });
  const [row] = await getDb().insert(classes).values({ ownerId: access.id, name, stage, grade, courseType: value(payload.courseType) || "一对多", startDate: value(payload.startDate) || null, schedule: value(payload.schedule), notes: value(payload.notes), status: "active" }).returning();
  await audit(access, "create", "class", row.id);
  return Response.json({ class: row }, { status: 201 });
}
