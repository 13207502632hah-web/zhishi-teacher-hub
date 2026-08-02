import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { reflections } from "../../../../db/schema";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";

const textFields = ["tags", "problemType", "expectedVsActual", "effectivePractices", "difficulties", "studentEvidence", "nextAction", "reusableMaterial"] as const;
const maxTextLength = 12_000;
const jsonError = (error: string, status: number) => Response.json({ error }, { status });
const serverError = () => jsonError("反思服务暂时无法处理请求，请稍后重试", 500);

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const booleanValue = (value: unknown, fallback = false) => {
  if (value === undefined) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
};

function parseReflectionPayload(input: unknown, existingStrategy = false) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: jsonError("请求内容必须是 JSON 对象", 400) } as const;
  const body = input as Record<string, unknown>;
  const date = String(body.date || "").trim();
  if (!isValidDate(date)) return { error: jsonError("日期格式无效，请使用 YYYY-MM-DD", 400) } as const;
  let lessonId: number | null = null;
  if (body.lessonId !== undefined && body.lessonId !== null && String(body.lessonId).trim()) {
    lessonId = Number(body.lessonId);
    if (!Number.isInteger(lessonId) || lessonId <= 0) return { error: jsonError("关联课时无效，请重新选择", 400) } as const;
  }
  for (const field of textFields) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== "string") return { error: jsonError(`${field} 必须是文本`, 400) } as const;
    if (String(value || "").length > maxTextLength) return { error: jsonError(`${field} 内容过长，请拆分后保存`, 413) } as const;
  }
  const isStrategy = booleanValue(body.isStrategy, existingStrategy);
  return {
    lessonId,
    isStrategy,
    values: {
      lessonId,
      date,
      tags: String(body.tags || "").trim(),
      problemType: String(body.problemType || "").trim(),
      expectedVsActual: String(body.expectedVsActual || "").trim(),
      effectivePractices: String(body.effectivePractices || "").trim(),
      difficulties: String(body.difficulties || "").trim(),
      studentEvidence: String(body.studentEvidence || "").trim(),
      nextAction: String(body.nextAction || "").trim(),
      actionCompleted: booleanValue(body.actionCompleted),
      reusableMaterial: String(body.reusableMaterial || "").trim(),
      isStrategy,
      isPrivate: true,
    },
  } as const;
}

const parseId = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const mapRow = (row: Record<string, unknown>) => ({
  ...row,
  lessonId: row.lesson_id,
  problemType: row.problem_type,
  expectedVsActual: row.expected_vs_actual,
  effectivePractices: row.effective_practices,
  studentEvidence: row.student_evidence,
  nextAction: row.next_action,
  actionCompleted: Boolean(row.action_completed),
  reusableMaterial: row.reusable_material,
  isStrategy: Boolean(row.is_strategy),
  isPrivate: Boolean(row.is_private),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

async function readReflection(id: number) {
  return env.DB.prepare("SELECT r.*,l.topic AS lessonTopic,l.course_name AS courseName,c.name AS className,c.id AS classId FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id LEFT JOIN classes c ON c.id=l.class_id WHERE r.id=?").bind(id).first<Record<string, unknown>>();
}

async function checkLessonAccess(access: Parameters<typeof requireLessonAccess>[0], row: Record<string, unknown>) {
  const lessonId = Number(row.lesson_id || 0);
  return lessonId ? requireLessonAccess(access, lessonId) : null;
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("reflections:read");
  if (isDenied(access)) return access;
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return jsonError("反思编号无效", 400);
    const row = await readReflection(id);
    if (!row) return jsonError("反思不存在", 404);
    const lessonDenied = await checkLessonAccess(access, row);
    if (lessonDenied) return lessonDenied;
    return Response.json({ reflection: mapRow(row) });
  } catch {
    return serverError();
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("reflections:write");
  if (isDenied(access)) return access;
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return jsonError("反思编号无效", 400);
    const existing = await readReflection(id);
    if (!existing) return jsonError("反思不存在", 404);
    const lessonDenied = await checkLessonAccess(access, existing);
    if (lessonDenied) return lessonDenied;
    const parsed = parseReflectionPayload(await request.json(), Boolean(existing.is_strategy));
    if ("error" in parsed) return parsed.error;
    if (parsed.lessonId) {
      const newLessonDenied = await requireLessonAccess(access, parsed.lessonId);
      if (newLessonDenied) return newLessonDenied;
    }
    if (parsed.isStrategy) {
      const resource = await env.DB.prepare("SELECT id FROM resources WHERE source_ref=? AND type='教学策略' LIMIT 1").bind(`reflection:${id}`).first<{ id: number }>();
      if (!resource) return jsonError("请先通过资源 API 明确选择并沉淀教学策略", 409);
    }
    const [row] = await getDb().update(reflections).set({ ...parsed.values, updatedAt: new Date().toISOString() }).where(eq(reflections.id, id)).returning();
    if (!row) return jsonError("反思不存在", 404);
    await audit(access, "update", "reflection", id);
    return Response.json({ reflection: row });
  } catch {
    return serverError();
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("reflections:write");
  if (isDenied(access)) return access;
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);
    if (!id) return jsonError("反思编号无效", 400);
    const existing = await readReflection(id);
    if (!existing) return jsonError("反思不存在", 404);
    const lessonDenied = await checkLessonAccess(access, existing);
    if (lessonDenied) return lessonDenied;
    const [deleted] = await getDb().delete(reflections).where(eq(reflections.id, id)).returning({ id: reflections.id });
    if (!deleted) return jsonError("反思不存在", 404);
    await audit(access, "delete", "reflection", id);
    return Response.json({ ok: true });
  } catch {
    return serverError();
  }
}
