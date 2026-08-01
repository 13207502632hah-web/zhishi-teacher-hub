import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../lib/access";

type PortalRole = "student" | "parent";
type BindingStatus = "active" | "unbound" | "pending" | "disabled";

const noStore = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const json = (body: unknown, init: ResponseInit = {}) => Response.json(body, {
  ...init,
  headers: { "Cache-Control": "private, no-store", ...(init.headers || {}) },
});

const emptyPayload = (role: PortalRole, bindingStatus: BindingStatus) => ({
  role,
  bindingStatus,
  dataState: bindingStatus === "active" ? "empty" : bindingStatus,
  sessionStatus: "active",
  students: [],
  assignments: [],
  feedback: [],
  results: [],
  resources: [],
});

async function linkedStudents(access: { id: number; role: PortalRole }) {
  const linkColumn = access.role === "parent" ? "guardian_user_id" : "user_id";
  const rows = await env.DB.prepare(`SELECT id,name,grade,stage_goal AS stageGoal FROM students WHERE ${linkColumn}=? AND status='active' ORDER BY name`).bind(access.id).all<Record<string, unknown>>();
  return rows.results.map((student) => ({
    id: Number(student.id),
    name: String(student.name || "学生"),
    grade: String(student.grade || ""),
    stageGoal: String(student.stageGoal || ""),
  }));
}

async function bindingStatus(access: { id: number; role: PortalRole }, hasStudents: boolean): Promise<BindingStatus> {
  if (hasStudents) return "active";
  const rows = await env.DB.prepare("SELECT wa.status AS accountStatus,mb.status AS bindingStatus FROM wechat_accounts wa LEFT JOIN mini_bindings mb ON mb.account_id=wa.id AND mb.role=? WHERE wa.user_id=? ORDER BY mb.status='active' DESC,mb.updated_at DESC").bind(access.role, access.id).all<{ accountStatus: string; bindingStatus: string | null }>();
  if (rows.results.some((row) => row.accountStatus === "disabled" || row.bindingStatus === "disabled")) return "disabled";
  if (rows.results.some((row) => row.bindingStatus === "pending")) return "pending";
  return "unbound";
}

const recipientForStudent = (assignmentAlias: string, studentExpression: string) => `(
  EXISTS(SELECT 1 FROM assignment_targets target WHERE target.assignment_id=${assignmentAlias}.id AND target.target_type='student' AND target.target_id=${studentExpression})
  OR (
    NOT EXISTS(SELECT 1 FROM assignment_targets targeted WHERE targeted.assignment_id=${assignmentAlias}.id AND targeted.target_type='student')
    AND EXISTS(SELECT 1 FROM enrollments enrollment WHERE enrollment.class_id=${assignmentAlias}.class_id AND enrollment.student_id=${studentExpression} AND enrollment.status='active')
  )
)`;

async function protectedFile(request: Request, studentIds: number[]) {
  const params = new URL(request.url).searchParams;
  const fileId = Number(params.get("fileId") || 0);
  const fileType = params.get("fileType") || "asset";
  if (!fileId || !["asset", "paper"].includes(fileType)) return null;

  const marks = studentIds.map(() => "?").join(",");
  if (!marks) return json({ error: "无权查看此文件" }, { status: 403 });

  let meta: Record<string, string> | null = null;
  let allowed = false;
  if (fileType === "asset") {
    meta = await env.DB.prepare("SELECT storage_key AS storageKey,original_name AS originalName,mime_type AS mimeType,status FROM file_assets WHERE id=?").bind(fileId).first<Record<string, string>>();
    if (meta?.status === "active") {
      const row = await env.DB.prepare(`SELECT 1 FROM assignment_assets aa JOIN assignments a ON a.id=aa.assignment_id WHERE aa.asset_id=? AND a.status='published' AND (
        EXISTS(SELECT 1 FROM assignment_targets target WHERE target.assignment_id=a.id AND target.target_type='student' AND target.target_id IN (${marks}))
        OR (
          NOT EXISTS(SELECT 1 FROM assignment_targets targeted WHERE targeted.assignment_id=a.id AND targeted.target_type='student')
          AND EXISTS(SELECT 1 FROM enrollments enrollment WHERE enrollment.class_id=a.class_id AND enrollment.student_id IN (${marks}) AND enrollment.status='active')
        )
      ) LIMIT 1`).bind(fileId, ...studentIds, ...studentIds).first();
      allowed = Boolean(row);
    }
  } else {
    meta = await env.DB.prepare("SELECT storage_key AS storageKey,original_name AS originalName,mime_type AS mimeType FROM paper_files WHERE id=? AND version_type='student'").bind(fileId).first<Record<string, string>>();
    if (meta) {
      const row = await env.DB.prepare(`SELECT 1 FROM paper_files paper JOIN assignments a ON a.paper_id=paper.paper_id WHERE paper.id=? AND paper.version_type='student' AND a.status='published' AND (
        EXISTS(SELECT 1 FROM assignment_targets target WHERE target.assignment_id=a.id AND target.target_type='student' AND target.target_id IN (${marks}))
        OR (
          NOT EXISTS(SELECT 1 FROM assignment_targets targeted WHERE targeted.assignment_id=a.id AND targeted.target_type='student')
          AND EXISTS(SELECT 1 FROM enrollments enrollment WHERE enrollment.class_id=a.class_id AND enrollment.student_id IN (${marks}) AND enrollment.status='active')
        )
      ) LIMIT 1`).bind(fileId, ...studentIds, ...studentIds).first();
      allowed = Boolean(row);
    }
  }

  if (!meta || !allowed) return json({ error: "文件不存在或无权查看" }, { status: meta ? 403 : 404 });
  const object = await env.FILES.get(meta.storageKey);
  if (!object) return json({ error: "文件内容不存在" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function assignmentAttachments(assignmentId: number, studentId: number, paperId: number | null) {
  const assetRows = await env.DB.prepare(`SELECT fa.id,fa.original_name AS name,fa.mime_type AS mimeType,fa.size FROM assignment_assets aa JOIN assignments a ON a.id=aa.assignment_id JOIN file_assets fa ON fa.id=aa.asset_id WHERE aa.assignment_id=? AND a.status='published' AND fa.status='active' AND ${recipientForStudent("a", "?")} ORDER BY aa.position`).bind(assignmentId, studentId, studentId).all<Record<string, unknown>>();
  const paperRows = paperId ? await env.DB.prepare("SELECT id,original_name AS name,mime_type AS mimeType,size FROM paper_files WHERE paper_id=? AND version_type='student' ORDER BY id DESC").bind(paperId).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] };
  return [
    ...assetRows.results.map((asset) => ({ id: Number(asset.id), name: String(asset.name || "附件"), mimeType: String(asset.mimeType || ""), size: Number(asset.size || 0), fileType: "asset", href: `/api/portal?fileType=asset&fileId=${Number(asset.id)}` })),
    ...paperRows.results.map((paper) => ({ id: Number(paper.id), name: String(paper.name || "学生版试卷"), mimeType: String(paper.mimeType || ""), size: Number(paper.size || 0), fileType: "paper", href: `/api/portal?fileType=paper&fileId=${Number(paper.id)}` })),
  ];
}

export async function GET(request: Request) {
  const access = await requirePermission("portal:read");
  if (isDenied(access)) return noStore(access);
  const role = access.role;
  if (role !== "student" && role !== "parent") return json({ error: "当前角色请使用教师工作台", code: "PORTAL_ROLE_REQUIRED" }, { status: 403 });
  const portalAccess = { id: access.id, role };

  const students = await linkedStudents(portalAccess);
  const status = await bindingStatus(portalAccess, students.length > 0);
  const fileResponse = await protectedFile(request, students.map((student) => student.id));
  if (fileResponse) return fileResponse;
  if (status !== "active") return json(emptyPayload(role, status));

  const ids = students.map((student) => student.id);
  if (!ids.length) return json(emptyPayload(role, "active"));
  const placeholders = ids.map(() => "?").join(",");
  const assignmentRows = await env.DB.prepare(`SELECT s.id AS submissionId,s.student_id AS studentId,s.status,s.score,s.review_tags AS reviewTags,s.submitted_at AS submittedAt,
    a.id AS assignmentId,a.paper_id AS paperId,a.title,a.requirements,a.due_at AS dueAt,a.status AS assignmentStatus
    FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id
    WHERE a.status='published' AND s.student_id IN (${placeholders}) AND ${recipientForStudent("a", "s.student_id")}
    ORDER BY CASE WHEN s.status='revision' THEN 0 WHEN s.status IN ('pending','submitted','revision_submitted') THEN 1 ELSE 2 END,
      CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END,a.due_at ASC,a.updated_at DESC`).bind(...ids).all<Record<string, unknown>>();

  const assignments = await Promise.all(assignmentRows.results.map(async (row) => {
    const submissionId = Number(row.submissionId), studentId = Number(row.studentId), statusValue = String(row.status || "pending");
    return {
      id: submissionId,
      submissionId,
      assignmentId: Number(row.assignmentId),
      studentId,
      title: String(row.title || "未命名作业"),
      requirements: String(row.requirements || ""),
      dueAt: row.dueAt ? String(row.dueAt) : null,
      status: statusValue,
      assignmentStatus: String(row.assignmentStatus || "published"),
      score: row.score == null ? null : Number(row.score),
      feedbackStatus: statusValue === "completed" ? "confirmed" : statusValue === "revision" ? "needs_revision" : statusValue === "revision_submitted" ? "awaiting_review" : "pending",
      needsAction: ["pending", "revision"].includes(statusValue),
      attachments: await assignmentAttachments(Number(row.assignmentId), studentId, row.paperId == null ? null : Number(row.paperId)),
    };
  }));

  const feedbackRows = await env.DB.prepare(`SELECT f.id,f.student_id AS studentId,f.type,
      CASE WHEN ?='parent' THEN COALESCE(NULLIF(f.parent_advice,''),NULLIF(f.short_content,''),f.content)
      ELSE COALESCE(NULLIF(f.learning_content,''),NULLIF(f.short_content,''),f.content) END AS content,
    f.confirmed_at AS confirmedAt,f.sent_at AS sentAt
    FROM feedback f WHERE f.status='confirmed' AND f.sent_at IS NOT NULL AND f.audience IN ('private','group') AND
      (f.student_id IN (${placeholders}) OR (f.student_id IS NULL AND f.class_id IN (SELECT enrollment.class_id FROM enrollments enrollment WHERE enrollment.student_id IN (${placeholders}) AND enrollment.status='active')))
    ORDER BY f.confirmed_at DESC LIMIT 50`).bind(access.role, ...ids, ...ids).all<Record<string, unknown>>();

  const results = role === "student" ? (await env.DB.prepare(`SELECT ar.id,ar.student_id AS studentId,a.title,a.date,a.total_score AS totalScore,ar.score,ar.weak_knowledge AS weakKnowledge
    FROM assessment_results ar JOIN assessments a ON a.id=ar.assessment_id WHERE a.status='completed' AND ar.student_id IN (${placeholders}) ORDER BY a.date DESC LIMIT 30`).bind(...ids).all<Record<string, unknown>>()).results : [];
  const resources = (await env.DB.prepare("SELECT id,title,type,tags,content,CASE WHEN url LIKE 'http://%' OR url LIKE 'https://%' THEN url ELSE NULL END AS href FROM resources WHERE visibility='public' ORDER BY updated_at DESC LIMIT 30").all<Record<string, unknown>>()).results;
  return json({ role, bindingStatus: "active", dataState: assignments.length || feedbackRows.results.length || results.length || resources.length ? "ready" : "empty", sessionStatus: "active", students, assignments, feedback: feedbackRows.results.map((row) => ({ id: Number(row.id), studentId: row.studentId == null ? null : Number(row.studentId), type: String(row.type || "lesson"), content: String(row.content || ""), feedbackStatus: "confirmed", confirmedAt: String(row.confirmedAt || ""), sentAt: String(row.sentAt || "") })), results, resources: resources.map((resource) => ({ id: Number(resource.id), title: String(resource.title || "资料"), type: String(resource.type || ""), tags: String(resource.tags || ""), content: String(resource.content || ""), href: resource.href ? String(resource.href) : null })) });
}
