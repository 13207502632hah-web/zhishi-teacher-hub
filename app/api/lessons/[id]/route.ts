import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { lessons } from "../../../../db/schema";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; const p = await request.json() as Record<string, string>;
  const [row] = await getDb().update(lessons).set({ courseName: p.courseName, date: p.date, startTime: p.startTime, endTime: p.endTime, mode: p.mode, location: p.location, grade: p.grade, stage: p.stage, textbookVersion: p.textbookVersion, volume: p.volume, unit: p.unit, topic: p.topic, teachingGoals: p.teachingGoals, keyPoints: p.keyPoints, difficultPoints: p.difficultPoints, actualContent: p.actualContent, materials: p.materials, activities: p.activities, homework: p.homework, nextPlan: p.nextPlan, status: p.status, updatedAt: new Date().toISOString() }).where(eq(lessons.id, Number(id))).returning();
  return Response.json({ lesson: row });
}
export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; await getDb().delete(lessons).where(eq(lessons.id, Number(id))); return Response.json({ ok: true });
}
