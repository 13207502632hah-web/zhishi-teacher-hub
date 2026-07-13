import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import type { MiniAccess } from "../mini-auth";
import { beginOperation, completeOperation, abandonOperation } from "./idempotency";
import { accessibleStudentIds, recordSyncEvent } from "./mini-sync-service";

export type AssignmentInput = {
  title: string;
  requirements?: string;
  classId?: number | null;
  studentIds?: number[];
  lessonId?: number | null;
  paperId?: number | null;
  dueAt?: string | null;
  reminderRule?: unknown;
  allowParentSubmit?: boolean;
  requireRevision?: boolean;
  assetIds?: number[];
  status?: "draft" | "published";
  operationId: string;
};

type AssignmentActor = { kind: "website"; access: AccessContext } | { kind: "mini"; access: MiniAccess };

export async function listAssignments(actor: AssignmentActor, filters: URLSearchParams) {
  const where: string[] = [], bind: unknown[] = [];
  let scopedStudentIds: number[] = [];
  if (actor.kind === "website" && actor.access.role === "assistant") {
    where.push("a.class_id IS NOT NULL AND EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.class_id=a.class_id AND sca.user_id=?)");
    bind.push(actor.access.id);
  }
  if (actor.kind === "mini" && actor.access.role !== "teacher") {
    const ids = await accessibleStudentIds(actor.access); scopedStudentIds = ids;
    if (!ids.length) return { assignments: [], counts: emptyCounts() };
    const marks = ids.map(() => "?").join(",");
    where.push(`a.status!='draft' AND (EXISTS(SELECT 1 FROM assignment_targets at WHERE at.assignment_id=a.id AND at.target_type='student' AND at.target_id IN (${marks})) OR (NOT EXISTS(SELECT 1 FROM assignment_targets st WHERE st.assignment_id=a.id AND st.target_type='student') AND EXISTS(SELECT 1 FROM enrollments e WHERE e.class_id=a.class_id AND e.student_id IN (${marks}) AND e.status='active')))`);
    bind.push(...ids, ...ids);
  }
  const status = filters.get("status");
  const classId = Number(filters.get("classId") || 0);
  const query = (filters.get("q") || "").trim();
  if (status && status !== "all") { where.push("a.status=?"); bind.push(status); }
  if (classId) { where.push("a.class_id=?"); bind.push(classId); }
  if (query) { where.push("(a.title LIKE ? OR a.requirements LIKE ?)"); bind.push(`%${query}%`, `%${query}%`); }
  const rows = await env.DB.prepare(`SELECT a.id,a.lesson_id AS lessonId,a.paper_id AS paperId,a.class_id AS classId,a.title,a.requirements,a.due_at AS dueAt,a.reminder_rule AS reminderRule,a.status,a.created_at AS createdAt,a.updated_at AS updatedAt,c.name AS className,p.title AS paperTitle,COALESCE(s.allow_parent_submit,1) AS allowParentSubmit,COALESCE(s.require_revision,1) AS requireRevision,s.published_at AS publishedAt,(SELECT COUNT(*) FROM assignment_submissions sub WHERE sub.assignment_id=a.id) AS recipientCount,(SELECT COUNT(*) FROM assignment_submissions sub WHERE sub.assignment_id=a.id AND sub.status IN ('submitted','revision_submitted')) AS pendingReviewCount,(SELECT COUNT(*) FROM assignment_submissions sub WHERE sub.assignment_id=a.id AND sub.status='revision') AS revisionCount,(SELECT COUNT(*) FROM assignment_submissions sub WHERE sub.assignment_id=a.id AND sub.status='completed') AS completedCount FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN papers p ON p.id=a.paper_id LEFT JOIN assignment_settings s ON s.assignment_id=a.id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.updated_at DESC,a.id DESC LIMIT 200`)
    .bind(...bind).all<Record<string, unknown>>();
  const assignments = [] as Record<string, unknown>[];
  for (const row of rows.results) {
    const [assets, targets] = await Promise.all([
      env.DB.prepare("SELECT fa.id,fa.original_name AS name,fa.mime_type AS mimeType,fa.size FROM assignment_assets aa JOIN file_assets fa ON fa.id=aa.asset_id WHERE aa.assignment_id=? AND fa.status='active' ORDER BY aa.position").bind(row.id).all(),
      env.DB.prepare("SELECT target_type AS targetType,target_id AS targetId FROM assignment_targets WHERE assignment_id=? ORDER BY id").bind(row.id).all(),
    ]);
    const paperFiles = row.paperId ? (await env.DB.prepare("SELECT id,original_name AS name,mime_type AS mimeType,size FROM paper_files WHERE paper_id=? AND version_type='student' ORDER BY id DESC").bind(row.paperId).all()).results : [];
    let scopedCounts: Record<string, number> = {};
    if (scopedStudentIds.length) {
      const own = await env.DB.prepare(`SELECT COUNT(*) AS recipientCount,SUM(CASE WHEN status IN ('submitted','revision_submitted') THEN 1 ELSE 0 END) AS pendingReviewCount,SUM(CASE WHEN status='revision' THEN 1 ELSE 0 END) AS revisionCount,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completedCount FROM assignment_submissions WHERE assignment_id=? AND student_id IN (${scopedStudentIds.map(() => "?").join(",")})`).bind(row.id, ...scopedStudentIds).first<Record<string, number>>();
      scopedCounts = own || {};
    }
    assignments.push({ ...row, ...scopedCounts, allowParentSubmit: Boolean(row.allowParentSubmit), requireRevision: Boolean(row.requireRevision), targets: targets.results, attachments: [...assets.results.map((item: any) => ({ ...item, url: `/api/mini/files/${item.id}` })), ...paperFiles.map((item: any) => ({ ...item, url: `/api/mini/paper-files/${item.id}`, wholePaper: true }))], assetCount: assets.results.length + paperFiles.length });
  }
  return { assignments, counts: countStatuses(assignments) };
}

export async function createAssignment(actor: AssignmentActor, input: AssignmentInput) {
  const title = String(input.title || "").trim(), classId = Number(input.classId || 0) || null;
  const studentIds = [...new Set((input.studentIds || []).map(Number).filter((id) => id > 0))];
  if (!title || (!classId && !studentIds.length)) return Response.json({ error: "请填写标题并选择班级或指定学生" }, { status: 400 });
  if (actor.kind === "mini") {
    if (!actor.access.userId) return Response.json({ error: "教师账号尚未关联网站用户" }, { status: 403 });
    if (classId) {
      const owned = await env.DB.prepare("SELECT 1 FROM classes WHERE id=? AND (owner_id IS NULL OR owner_id=?)").bind(classId, actor.access.userId).first();
      if (!owned) return Response.json({ error: "无权向该班级布置作业" }, { status: 403 });
    }
  }
  if (studentIds.length) {
    const valid = await env.DB.prepare(`SELECT COUNT(*) AS count FROM students WHERE id IN (${studentIds.map(() => "?").join(",")}) AND status='active'`).bind(...studentIds).first<{ count: number }>();
    if (Number(valid?.count || 0) !== studentIds.length) return Response.json({ error: "指定学生中包含不存在或已停用的档案" }, { status: 400 });
  }
  const actorInfo = actor.kind === "website" ? { type: "user" as const, id: actor.access.id } : { type: "mini_account" as const, id: actor.access.accountId };
  const operation = await beginOperation(actorInfo, "assignment.create", input.operationId);
  if ("error" in operation) return operation.error;
  if (!operation.acquired) return Response.json(operation.result, { status: 200 });
  try {
    const status = input.status === "draft" ? "draft" : "published";
    const row = await env.DB.prepare("INSERT INTO assignments(lesson_id,paper_id,class_id,title,requirements,due_at,reminder_rule,status) VALUES(?,?,?,?,?,?,?,?) RETURNING id")
      .bind(input.lessonId || null, input.paperId || null, classId, title, input.requirements || null, input.dueAt || null, input.reminderRule ? JSON.stringify(input.reminderRule) : null, status).first<{ id: number }>();
    if (!row) throw new Error("作业创建失败");
    await env.DB.prepare("INSERT INTO assignment_settings(assignment_id,allow_parent_submit,require_revision,published_at) VALUES(?,?,?,CASE WHEN ?='published' THEN CURRENT_TIMESTAMP ELSE NULL END)")
      .bind(row.id, input.allowParentSubmit === false ? 0 : 1, input.requireRevision === false ? 0 : 1, status).run();
    if (classId) await env.DB.prepare("INSERT OR IGNORE INTO assignment_targets(assignment_id,target_type,target_id) VALUES(?, 'class', ?)").bind(row.id, classId).run();
    for (const studentId of studentIds) await env.DB.prepare("INSERT OR IGNORE INTO assignment_targets(assignment_id,target_type,target_id) VALUES(?, 'student', ?)").bind(row.id, studentId).run();
    const recipients = studentIds.length ? studentIds : classId ? (await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(classId).all<{ studentId: number }>()).results.map((item) => Number(item.studentId)) : [];
    for (const studentId of recipients) await env.DB.prepare("INSERT OR IGNORE INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,'pending')").bind(row.id, studentId).run();
    for (const [position, assetId] of (input.assetIds || []).entries()) {
      const asset = actor.kind === "website"
        ? await env.DB.prepare("SELECT id FROM file_assets WHERE id=? AND status='active' AND ((owner_type='user' AND owner_id=?) OR created_by=?)").bind(Number(assetId), actor.access.id, actor.access.id).first()
        : await env.DB.prepare("SELECT id FROM file_assets WHERE id=? AND status='active' AND ((owner_type='mini_account' AND owner_id=?) OR created_by=?)").bind(Number(assetId), actor.access.accountId, actor.access.userId).first();
      if (!asset) throw new Error("附件不存在或已失效");
      await env.DB.batch([
        env.DB.prepare("INSERT INTO assignment_assets(assignment_id,asset_id,position) VALUES(?,?,?)").bind(row.id, Number(assetId), position),
        env.DB.prepare("INSERT INTO file_leases(asset_id,state,linked_entity_type,linked_entity_id) VALUES(?, 'linked','assignment',?) ON CONFLICT(asset_id) DO UPDATE SET state='linked',linked_entity_type='assignment',linked_entity_id=excluded.linked_entity_id,updated_at=CURRENT_TIMESTAMP").bind(Number(assetId), String(row.id)),
      ]);
    }
    if (status === "published") {
      await recordSyncEvent({ eventType: "assignment.published", entityType: "assignment", entityId: row.id, audienceRole: "teacher", payload: { title, recipientCount: recipients.length } });
      for (const studentId of recipients) {
        await recordSyncEvent({ eventType: "assignment.published", entityType: "assignment", entityId: row.id, studentId, payload: { title, dueAt: input.dueAt || null } });
        if (input.reminderRule) await env.DB.prepare("INSERT OR IGNORE INTO reminder_tasks(event_type,entity_type,entity_id,student_id,operation_id,status,scheduled_at) VALUES('assignment.due','assignment',?,?,?,'pending',?)")
          .bind(String(row.id), studentId, `${input.operationId}:reminder:${studentId}`, input.dueAt || null).run();
      }
    }
    const result = { id: row.id, status, recipientCount: recipients.length };
    await completeOperation(actorInfo, "assignment.create", input.operationId, result);
    return Response.json(result, { status: 201 });
  } catch (error) {
    await abandonOperation(actorInfo, "assignment.create", input.operationId);
    return Response.json({ error: error instanceof Error ? error.message : "作业创建失败" }, { status: 500 });
  }
}

function emptyCounts() { return { total: 0, draft: 0, published: 0, pendingReview: 0, revision: 0, completed: 0 }; }
function countStatuses(items: Record<string, unknown>[]) {
  const result = emptyCounts(); result.total = items.length;
  for (const item of items) { if (item.status === "draft") result.draft++; else result.published++; result.pendingReview += Number(item.pendingReviewCount || 0); result.revision += Number(item.revisionCount || 0); result.completed += Number(item.completedCount || 0); }
  return result;
}
