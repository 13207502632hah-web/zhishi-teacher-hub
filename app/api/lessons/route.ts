import { desc, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { lessons } from "../../../db/schema";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  const db = getDb();
  const rows = query ? await db.select().from(lessons).where(or(like(lessons.courseName, `%${query}%`), like(lessons.topic, `%${query}%`))).orderBy(desc(lessons.date)) : await db.select().from(lessons).orderBy(desc(lessons.date));
  return Response.json({ lessons: rows });
}
export async function POST(request: Request) {
  const p = await request.json() as Record<string, string | number | null>;
  if (!p.date || !p.courseName || !p.stage || !p.grade) return Response.json({ error: "日期、课程名称、学段和年级为必填项" }, { status: 400 });
  const db = getDb();
  const [row] = await db.insert(lessons).values({ date: String(p.date), startTime: String(p.startTime || ""), endTime: String(p.endTime || ""), mode: String(p.mode || "offline"), location: String(p.location || ""), onlineLink: String(p.onlineLink || ""), courseName: String(p.courseName), stage: String(p.stage), grade: String(p.grade), textbookVersion: String(p.textbookVersion || ""), volume: String(p.volume || ""), unit: String(p.unit || ""), topic: String(p.topic || ""), teachingGoals: String(p.teachingGoals || ""), keyPoints: String(p.keyPoints || ""), difficultPoints: String(p.difficultPoints || ""), status: String(p.status || "draft") }).returning();
  return Response.json({ lesson: row }, { status: 201 });
}
