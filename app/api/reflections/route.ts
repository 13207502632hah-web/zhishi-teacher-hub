import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { reflections } from "../../../db/schema";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../lib/access";

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

export async function GET(request: Request) {
  const access = await requirePermission("reflections:read");
  if (isDenied(access)) return access;
  try {
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") || "").slice(0, 200);
    const tag = (params.get("tag") || "").slice(0, 100);
    const month = params.get("month") || "";
    const topic = (params.get("topic") || "").slice(0, 200);
    const problemType = params.get("problemType") || "";
    const classId = params.get("classId") || "";
    const where: string[] = ["1=1"];
    const bind: unknown[] = [];
    if (month && !/^\d{4}-\d{2}$/.test(month)) return jsonError("月份格式无效", 400);
    if (classId && (!Number.isInteger(Number(classId)) || Number(classId) <= 0)) return jsonError("班级筛选无效", 400);
    if (q) {
      where.push("(r.expected_vs_actual LIKE ? OR r.effective_practices LIKE ? OR r.difficulties LIKE ? OR r.student_evidence LIKE ? OR r.next_action LIKE ? OR r.reusable_material LIKE ?)");
      for (let index = 0; index < 6; index += 1) bind.push(`%${q}%`);
    }
    if (tag) { where.push("r.tags LIKE ?"); bind.push(`%${tag}%`); }
    if (month) { where.push("r.date LIKE ?"); bind.push(`${month}%`); }
    if (topic) { where.push("l.topic LIKE ?"); bind.push(`%${topic}%`); }
    if (problemType) { where.push("r.problem_type=?"); bind.push(problemType); }
    if (classId) { where.push("l.class_id=?"); bind.push(Number(classId)); }
    const sql = `SELECT r.*,l.topic AS lessonTopic,l.course_name AS courseName,c.name AS className,c.id AS classId FROM reflections r LEFT JOIN lessons l ON l.id=r.lesson_id LEFT JOIN classes c ON c.id=l.class_id WHERE ${where.join(" AND ")} ORDER BY r.date DESC,r.updated_at DESC`;
    const result = await env.DB.prepare(sql).bind(...bind).all<Record<string, unknown>>();
    return Response.json({ reflections: result.results.map(mapRow) });
  } catch {
    return serverError();
  }
}

export async function POST(request: Request) {
  const access = await requirePermission("reflections:write");
  if (isDenied(access)) return access;
  try {
    const parsed = parseReflectionPayload(await request.json());
    if ("error" in parsed) return parsed.error;
    if (parsed.isStrategy) return jsonError("请先通过资源 API 明确选择并沉淀教学策略", 409);
    if (parsed.lessonId) {
      const lessonDenied = await requireLessonAccess(access, parsed.lessonId);
      if (lessonDenied) return lessonDenied;
    }
    const [row] = await getDb().insert(reflections).values({ ...parsed.values, isStrategy: false }).returning();
    if (!row) return serverError();
    await audit(access, "create", "reflection", row.id);
    return Response.json({ reflection: row }, { status: 201 });
  } catch {
    return serverError();
  }
}
