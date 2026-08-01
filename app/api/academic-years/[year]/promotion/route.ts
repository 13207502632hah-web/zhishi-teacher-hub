import { env } from "cloudflare:workers";
import { academicYearDates, promotionForGrade } from "../../../../lib/academic-workflow";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import { ensurePromotionRun } from "../../../../lib/services/grade-promotion-service";

const PREVIEW_TTL_MS = 15 * 60 * 1000;

type DbRow = Record<string, unknown>;

type PreviewItem = {
  id: number;
  studentId: number;
  name: string;
  school: string | null;
  classNames: string;
  classIds: number[];
  fromGrade: string;
  toGrade: string;
  action: string;
  status: string;
  reason: string | null;
  currentGrade: string | null;
  studentStatus: string | null;
  conflict: boolean;
  conflictReason: string | null;
};

type SkippedItem = {
  studentId: number;
  name: string;
  grade: string | null;
  reason: string;
};

type PreviewSummary = {
  affectedStudentCount: number;
  affectedClassCount: number;
  graduationCount: number;
  skippedCount: number;
  conflictCount: number;
};

const yearFrom = async (context: { params: Promise<{ year: string }> }) => {
  try {
    return decodeURIComponent((await context.params).year).trim();
  } catch {
    return "";
  }
};

const numberValue = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const textValue = (value: unknown) => (value == null ? "" : String(value));

const normalizeNullableText = (value: unknown) => {
  const text = textValue(value).trim();
  return text || null;
};

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createPreviewToken(snapshot: string, issuedAt: number) {
  return `${issuedAt}.${await digest(`${issuedAt}:${snapshot}`)}`;
}

async function isPreviewTokenValid(token: string, snapshot: string) {
  const [issuedAtText, signature, extra] = token.split(".");
  const issuedAt = Number(issuedAtText);
  const now = Date.now();
  if (extra || !signature || !Number.isSafeInteger(issuedAt) || issuedAt > now + 1000 || now - issuedAt > PREVIEW_TTL_MS) return false;
  return signature === await digest(`${issuedAt}:${snapshot}`);
}

function conflictReason(row: DbRow, runStatus: string, itemStatus: string, fromGrade: string) {
  if (runStatus !== "preview" || itemStatus !== "pending") return null;
  if (row.existingStudentId == null) return "学生记录不存在";
  if (textValue(row.studentStatus) !== "active") return "学生已不再 active";
  if (textValue(row.currentGrade) !== fromGrade) return `当前年级已变为${textValue(row.currentGrade) || "未填写"}`;
  return null;
}

async function collectPreview(db: D1Database, run: DbRow) {
  const runId = numberValue(run.id);
  const [itemRows, activeStudents, enrollmentRows] = await Promise.all([
    db.prepare("SELECT gpi.id,gpi.student_id AS studentId,gpi.from_grade AS fromGrade,gpi.to_grade AS toGrade,gpi.action,gpi.status,gpi.reason,s.id AS existingStudentId,s.name,s.school,s.grade AS currentGrade,s.status AS studentStatus,s.updated_at AS studentUpdatedAt FROM grade_promotion_items gpi LEFT JOIN students s ON s.id=gpi.student_id WHERE gpi.run_id=? ORDER BY gpi.from_grade,COALESCE(s.name,'')").bind(runId).all<DbRow>(),
    db.prepare("SELECT id,name,grade,status,updated_at AS updatedAt FROM students WHERE status='active' ORDER BY name,id").all<DbRow>(),
    db.prepare("SELECT e.student_id AS studentId,e.class_id AS classId,e.status AS enrollmentStatus,c.name AS className,c.grade AS classGrade,c.status AS classStatus,c.updated_at AS classUpdatedAt FROM enrollments e JOIN classes c ON c.id=e.class_id ORDER BY e.student_id,e.class_id").all<DbRow>(),
  ]);

  const classesByStudent = new Map<number, Array<{ id: number; name: string; grade: string; enrollmentStatus: string; status: string; updatedAt: string }>>();
  for (const row of enrollmentRows.results) {
    const studentId = numberValue(row.studentId);
    const entries = classesByStudent.get(studentId) || [];
    entries.push({
      id: numberValue(row.classId),
      name: textValue(row.className),
      grade: textValue(row.classGrade),
      enrollmentStatus: textValue(row.enrollmentStatus),
      status: textValue(row.classStatus),
      updatedAt: textValue(row.classUpdatedAt),
    });
    classesByStudent.set(studentId, entries);
  }

  const items: PreviewItem[] = itemRows.results.map((row) => {
    const studentId = numberValue(row.studentId);
    const fromGrade = textValue(row.fromGrade);
    const currentConflict = conflictReason(row, textValue(run.status), textValue(row.status), fromGrade);
    const classes = (classesByStudent.get(studentId) || []).filter((item) => item.enrollmentStatus === "active" && item.status === "active");
    return {
      id: numberValue(row.id),
      studentId,
      name: textValue(row.name) || "学生记录已删除",
      school: normalizeNullableText(row.school),
      classNames: [...new Set(classes.map((item) => item.name).filter(Boolean))].join("、"),
      classIds: [...new Set(classes.map((item) => item.id).filter(Boolean))],
      fromGrade,
      toGrade: textValue(row.toGrade),
      action: textValue(row.action),
      status: textValue(row.status),
      reason: normalizeNullableText(row.reason),
      currentGrade: normalizeNullableText(row.currentGrade),
      studentStatus: normalizeNullableText(row.studentStatus),
      conflict: Boolean(currentConflict),
      conflictReason: currentConflict,
    };
  });

  const plannedStudentIds = new Set(items.map((item) => item.studentId));
  const skipped: SkippedItem[] = activeStudents.results
    .filter((student) => !plannedStudentIds.has(numberValue(student.id)) && !promotionForGrade(textValue(student.grade)))
    .map((student) => ({
      studentId: numberValue(student.id),
      name: textValue(student.name),
      grade: normalizeNullableText(student.grade),
      reason: "当前年级没有可用晋升规则",
    }));

  const classIds = new Set(items.flatMap((item) => item.classIds));
  const summary: PreviewSummary = {
    affectedStudentCount: items.length,
    affectedClassCount: classIds.size,
    graduationCount: items.filter((item) => item.action === "graduate" || item.toGrade === "毕业").length,
    skippedCount: skipped.length,
    conflictCount: items.filter((item) => item.conflict).length,
  };

  const snapshot = JSON.stringify({
    run: { id: runId, status: textValue(run.status), updatedAt: textValue(run.updated_at), createdAt: textValue(run.created_at) },
    items: itemRows.results.map((row) => ({
      id: numberValue(row.id),
      studentId: numberValue(row.studentId),
      fromGrade: textValue(row.fromGrade),
      toGrade: textValue(row.toGrade),
      action: textValue(row.action),
      status: textValue(row.status),
      reason: textValue(row.reason),
      existingStudentId: row.existingStudentId == null ? null : numberValue(row.existingStudentId),
      name: textValue(row.name),
      school: textValue(row.school),
      currentGrade: textValue(row.currentGrade),
      studentStatus: textValue(row.studentStatus),
      studentUpdatedAt: textValue(row.studentUpdatedAt),
    })),
    activeStudents: activeStudents.results.map((row) => ({ id: numberValue(row.id), name: textValue(row.name), grade: textValue(row.grade), status: textValue(row.status), updatedAt: textValue(row.updatedAt) })),
    enrollments: enrollmentRows.results.map((row) => ({ studentId: numberValue(row.studentId), classId: numberValue(row.classId), enrollmentStatus: textValue(row.enrollmentStatus), className: textValue(row.className), classGrade: textValue(row.classGrade), classStatus: textValue(row.classStatus), classUpdatedAt: textValue(row.classUpdatedAt) })),
  });

  return { items, skipped, summary, snapshot };
}

async function previewResponse(db: D1Database, run: DbRow) {
  const collected = await collectPreview(db, run);
  const issuedAt = Date.now();
  return {
    run,
    items: collected.items.map((item) => {
      const { classIds, ...visibleItem } = item;
      void classIds;
      return visibleItem;
    }),
    skipped: collected.skipped,
    summary: collected.summary,
    previewToken: await createPreviewToken(collected.snapshot, issuedAt),
    previewExpiresAt: new Date(issuedAt + PREVIEW_TTL_MS).toISOString(),
    notice: "预览只读取当前学生、班级和报名关系；确认前不会修改学生或班级数据。数据变化、冲突或预览过期时必须重新生成。",
  };
}

const freshnessGuard = (runIdPlaceholder: string, status = "pending") => `NOT EXISTS (SELECT 1 FROM grade_promotion_items i LEFT JOIN students s ON s.id=i.student_id WHERE i.run_id=${runIdPlaceholder} AND i.status='${status}' AND (s.id IS NULL OR s.status<>'active' OR s.grade<>i.from_grade OR i.to_grade IS NULL))`;

export async function GET(_: Request, context: { params: Promise<{ year: string }> }) {
  const access = await requirePermission("academic-years:read");
  if (isDenied(access)) return access;
  const isTeacher = access.role === "teacher";
  if (!isTeacher) return Response.json({ error: "只有教师可以查看学年晋升预览" }, { status: 403 });
  const year = await yearFrom(context);
  if (!academicYearDates(year)) return Response.json({ error: "学年格式应为2025-2026，且结束年份必须比开始年份大1" }, { status: 400 });
  const run = await ensurePromotionRun(env.DB, year);
  if (!run) return Response.json({ error: "无法创建学年晋升预览" }, { status: 500 });
  return Response.json(await previewResponse(env.DB, run));
}

export async function POST(request: Request, context: { params: Promise<{ year: string }> }) {
  const access = await requirePermission("academic-years:write");
  if (isDenied(access)) return access;
  const isTeacher = access.role === "teacher";
  if (!isTeacher) return Response.json({ error: "只有教师可以执行学年晋升" }, { status: 403 });
  const year = await yearFrom(context);
  if (!academicYearDates(year)) return Response.json({ error: "学年格式应为2025-2026，且结束年份必须比开始年份大1" }, { status: 400 });

  const body = await request.json().catch(() => null) as { confirmation?: unknown; previewToken?: unknown; excludedStudentIds?: unknown } | null;
  const isConfirmed = body?.confirmation === "确认晋升";
  if (!isConfirmed) return Response.json({ error: "必须输入明确的确认文字“确认晋升”" }, { status: 400 });
  if (typeof body?.previewToken !== "string" || !body.previewToken.trim()) return Response.json({ error: "缺少有效的预览凭证，请重新生成预览", requiresPreview: true }, { status: 409 });

  const run = await ensurePromotionRun(env.DB, year);
  if (!run) return Response.json({ error: "无法读取学年晋升预览" }, { status: 500 });
  const runId = numberValue(run.id);
  if (run.status === "confirmed") return Response.json({ error: "该学年晋升已经确认，不能重复提交", alreadyConfirmed: true }, { status: 409 });
  if (run.status !== "preview") return Response.json({ error: "晋升正在处理或状态异常，请重新生成预览", requiresPreview: true }, { status: 409 });

  const excluded = [...new Set((Array.isArray(body?.excludedStudentIds) ? body.excludedStudentIds : []).map(Number))];
  if (excluded.some((id) => !Number.isSafeInteger(id) || id <= 0)) return Response.json({ error: "跳过项包含无效的学生" }, { status: 400 });

  const current = await collectPreview(env.DB, run);
  const tokenValid = await isPreviewTokenValid(body.previewToken, current.snapshot);
  const itemStudentIds = new Set(current.items.map((item) => item.studentId));
  if (!tokenValid || current.summary.conflictCount > 0 || excluded.some((id) => !itemStudentIds.has(id))) {
    return Response.json({ error: "预览已过期或存在数据冲突，请重新生成预览", requiresPreview: true, conflicts: current.summary.conflictCount, previewExpiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString() }, { status: 409 });
  }
  if (!current.items.length) return Response.json({ error: "当前没有可确认的晋升项，请重新生成预览", requiresPreview: true }, { status: 409 });

  const eligible = current.items.filter((item) => !excluded.includes(item.studentId));
  const statements: D1PreparedStatement[] = [];
  const claimGuard = freshnessGuard("?");
  statements.push(env.DB.prepare(`UPDATE grade_promotion_runs SET status='confirming',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='preview' AND ${claimGuard}`).bind(runId, runId));

  if (excluded.length) {
    const marks = excluded.map(() => "?").join(",");
    statements.push(env.DB.prepare(`UPDATE grade_promotion_items SET status='excluded',reason='教师确认跳过',updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending' AND student_id IN (${marks}) AND EXISTS (SELECT 1 FROM grade_promotion_runs r WHERE r.id=? AND r.status='confirming')`).bind(runId, ...excluded, runId));
  }

  if (eligible.length) {
    const caseParts = eligible.map(() => "WHEN ? THEN ?").join(" ");
    const caseBindings = eligible.flatMap((item) => [item.studentId, item.toGrade]);
    const conditions = eligible.map(() => "(id=? AND grade=? AND status='active')").join(" OR ");
    const eligibleIds = eligible.map((item) => item.studentId);
    const studentGuard = freshnessGuard("?");
    statements.push(env.DB.prepare(`UPDATE students SET grade=CASE id ${caseParts} ELSE grade END,updated_at=CURRENT_TIMESTAMP WHERE (${conditions}) AND ${studentGuard} AND EXISTS (SELECT 1 FROM grade_promotion_runs r WHERE r.id=? AND r.status='confirming')`).bind(...caseBindings, ...eligible.flatMap((item) => [item.studentId, item.fromGrade]), runId, runId));
    const marks = eligibleIds.map(() => "?").join(",");
    statements.push(env.DB.prepare(`UPDATE grade_promotion_items SET status='confirmed',updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND status='pending' AND student_id IN (${marks}) AND EXISTS (SELECT 1 FROM students s WHERE s.id=grade_promotion_items.student_id AND s.status='active' AND s.grade=grade_promotion_items.to_grade) AND EXISTS (SELECT 1 FROM grade_promotion_runs r WHERE r.id=? AND r.status='confirming')`).bind(runId, ...eligibleIds, runId));
  }

  const completionGuard = `NOT EXISTS (SELECT 1 FROM grade_promotion_items i LEFT JOIN students s ON s.id=i.student_id WHERE i.run_id=? AND (i.status='pending' OR (i.status='confirmed' AND (s.id IS NULL OR s.status<>'active' OR s.grade<>i.to_grade))))`;
  statements.push(env.DB.prepare(`UPDATE grade_promotion_runs SET status='confirmed',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='confirming' AND ${completionGuard}`).bind(access.id, runId, runId));

  const results = await env.DB.batch(statements);
  const claimed = Number(results[0]?.meta?.changes || 0) === 1;
  const completed = Number(results[results.length - 1]?.meta?.changes || 0) === 1;
  if (!claimed || !completed) {
    await env.DB.prepare("UPDATE grade_promotion_runs SET status='preview',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='confirming'").bind(runId).run();
    return Response.json({ error: "晋升未完成，未显示成功；请重新生成预览", requiresPreview: true }, { status: 409 });
  }

  await audit(access, "confirm", "grade_promotion_run", runId, { academicYear: year, excluded });
  return Response.json({ ok: true, runId, confirmed: eligible.length, excluded: excluded.length });
}
