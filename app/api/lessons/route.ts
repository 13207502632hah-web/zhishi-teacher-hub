import { desc, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { lessons } from "../../../db/schema";
import { audit, isDenied, requirePermission } from "../../lib/access";

export async function GET(request: Request) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const db = getDb();
  const rows = query ? await db.select().from(lessons).where(or(like(lessons.courseName, `%${query}%`), like(lessons.topic, `%${query}%`))).orderBy(desc(lessons.date)) : await db.select().from(lessons).orderBy(desc(lessons.date));
  return Response.json({ lessons: rows });
}
export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const p = await request.json() as Record<string, string | number | null>;
  if (!p.date || !p.courseName || !p.stage || !p.grade) return Response.json({ error: "日期、课程名称、学段和年级为必填项" }, { status: 400 });
  const db = getDb();
  const [row] = await db.insert(lessons).values({ classId: p.classId ? Number(p.classId) : null, date: String(p.date), startTime: String(p.startTime || ""), endTime: String(p.endTime || ""), mode: String(p.mode || "offline"), location: String(p.location || ""), onlineLink: String(p.onlineLink || ""), courseName: String(p.courseName), stage: String(p.stage), grade: String(p.grade), textbookVersion: String(p.textbookVersion || ""), volume: String(p.volume || ""), unit: String(p.unit || ""), topic: String(p.topic || ""), teachingGoals: String(p.teachingGoals || ""), keyPoints: String(p.keyPoints || ""), difficultPoints: String(p.difficultPoints || ""), actualContent: String(p.actualContent || ""), materials: String(p.materials || ""), activities: String(p.activities || ""), homework: String(p.homework || ""), nextPlan: String(p.nextPlan || ""), participation: p.participation ? Number(p.participation) : null, understanding: p.understanding ? Number(p.understanding) : null, completion: p.completion ? Number(p.completion) : null, discipline: p.discipline ? Number(p.discipline) : null, status: String(p.status || "draft") }).returning();
  await audit(access, "create", "lesson", row.id, { status: row.status });
  return Response.json({ lesson: row }, { status: 201 });
}
