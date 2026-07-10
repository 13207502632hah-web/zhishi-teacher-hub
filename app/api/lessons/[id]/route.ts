import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { lessons } from "../../../../db/schema";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const [row] = await getDb().select().from(lessons).where(eq(lessons.id, Number(id))).limit(1);
  return row ? Response.json({ lesson: row }) : Response.json({ error: "课时不存在" }, { status: 404 });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; const p = await request.json() as Record<string, string>;
  const [row] = await getDb().update(lessons).set({ classId: p.classId ? Number(p.classId) : null, courseName: p.courseName, date: p.date, startTime: p.startTime, endTime: p.endTime, mode: p.mode, location: p.location, onlineLink: p.onlineLink, grade: p.grade, stage: p.stage, textbookVersion: p.textbookVersion, volume: p.volume, unit: p.unit, topic: p.topic, teachingGoals: p.teachingGoals, keyPoints: p.keyPoints, difficultPoints: p.difficultPoints, actualContent: p.actualContent, materials: p.materials, activities: p.activities, homework: p.homework, nextPlan: p.nextPlan, participation: p.participation ? Number(p.participation) : null, understanding: p.understanding ? Number(p.understanding) : null, completion: p.completion ? Number(p.completion) : null, discipline: p.discipline ? Number(p.discipline) : null, status: p.status, updatedAt: new Date().toISOString() }).where(eq(lessons.id, Number(id))).returning();
  return Response.json({ lesson: row });
}
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; await getDb().delete(lessons).where(eq(lessons.id, Number(id))); return Response.json({ ok: true });
}
