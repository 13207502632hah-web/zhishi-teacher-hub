import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { enrollments, students } from "../../../db/schema";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../lib/access";

const value = (input: unknown) => String(input || "").trim();

export async function GET(request: Request) {
  const access = await requirePermission("students:read"); if (isDenied(access)) return access;
  const params = new URL(request.url).searchParams, q = params.get("q") || "", grade = params.get("grade") || "", risk = params.get("risk") || "", classId = Number(params.get("classId") || 0), status = params.get("status") || "active";
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const conditions: string[] = [], bind: unknown[] = [];
  if (classId) { conditions.push("EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id=s.id AND e.class_id=? AND e.status='active')"); bind.push(classId); }
  if (access.role === "assistant") { conditions.push("EXISTS (SELECT 1 FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE e.student_id=s.id AND e.status='active' AND sca.user_id=?)"); bind.push(access.id); }
  if (q) { conditions.push("(s.name LIKE ? OR s.nickname LIKE ? OR s.weak_knowledge LIKE ? OR s.school LIKE ?)"); bind.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (grade) { conditions.push("s.grade=?"); bind.push(grade); }
  if (risk === "confirmed") conditions.push("s.risk_confirmed=1");
  if (status !== "all") { conditions.push("s.status=?"); bind.push(status === "archived" ? "archived" : "active"); }
  const sql = `SELECT s.id,s.name,s.nickname,s.grade,s.school AS school,s.textbook_version AS textbookVersion,s.subject_choice AS subjectChoice,s.exam_goal AS examGoal,s.foundation_level AS foundationLevel,s.strengths,s.weak_knowledge AS weakKnowledge,s.learning_habits AS learningHabits,s.stage_goal AS stageGoal,s.risk_tags AS riskTags,s.risk_confirmed AS riskConfirmed,s.status,s.notes,s.created_at AS createdAt,s.updated_at AS updatedAt FROM students s ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END,s.updated_at DESC`;
  const rows = await env.DB.prepare(sql).bind(...bind).all();
  return Response.json({ students: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("students:write"); if (isDenied(access)) return access;
  const payload = await request.json() as Record<string, unknown>, name = value(payload.name), grade = value(payload.grade), classId = Number(payload.classId || 0);
  if (!name || !grade) return Response.json({ error: "姓名与年级为必填项" }, { status: 400 });
  if (name.length > 40) return Response.json({ error: "学生姓名不超过 40 个字符" }, { status: 400 });
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  const db = getDb(), [row] = await db.insert(students).values({ name, nickname: value(payload.nickname), grade, school: value(payload.school), textbookVersion: value(payload.textbookVersion), subjectChoice: value(payload.subjectChoice), examGoal: value(payload.examGoal), guardianContact: value(payload.guardianContact), foundationLevel: value(payload.foundationLevel), strengths: value(payload.strengths), weakKnowledge: value(payload.weakKnowledge), learningHabits: value(payload.learningHabits), stageGoal: value(payload.stageGoal), riskTags: value(payload.riskTags), riskConfirmed: payload.riskConfirmed === true || payload.riskConfirmed === "true", status: "active", notes: value(payload.notes) }).returning();
  if (classId) await db.insert(enrollments).values({ classId, studentId: row.id }).onConflictDoUpdate({ target: [enrollments.classId, enrollments.studentId], set: { status: "active" } });
  await audit(access, "create", "student", row.id, { classId: classId || null });
  return Response.json({ student: row }, { status: 201 });
}
