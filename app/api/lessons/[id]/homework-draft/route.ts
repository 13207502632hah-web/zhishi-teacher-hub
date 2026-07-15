import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const lessonId = Number((await context.params).id), denied = await requireLessonAccess(access, lessonId); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>, questionIds = [...new Set((Array.isArray(body.questionIds) ? body.questionIds : []).map(Number).filter((value) => value > 0))].slice(0, 100);
  if (!questionIds.length) return Response.json({ error: "请至少选择一道正式题目" }, { status: 400 });
  const lesson = await env.DB.prepare("SELECT id,class_id AS classId,date,course_name AS courseName,stage,grade,textbook_version AS textbookVersion,topic FROM lessons WHERE id=?").bind(lessonId).first<Record<string, any>>();
  if (!lesson?.classId) return Response.json({ error: "创建作业草稿前，课时必须关联班级" }, { status: 400 });
  const marks = questionIds.map(() => "?").join(","), active = await env.DB.prepare(`SELECT id FROM questions WHERE status='active' AND id IN (${marks})`).bind(...questionIds).all<{ id: number }>();
  if (active.results.length !== questionIds.length) return Response.json({ error: "所选题目中包含未正式入库的题目" }, { status: 409 });
  const state = await env.DB.prepare("SELECT homework_paper_id AS paperId,homework_assignment_id AS assignmentId FROM lesson_workflow_state WHERE lesson_id=?").bind(lessonId).first<{ paperId: number | null; assignmentId: number | null }>();
  let assignment = state?.assignmentId ? await env.DB.prepare("SELECT id,paper_id AS paperId,status FROM assignments WHERE id=?").bind(state.assignmentId).first<Record<string, any>>() : null;
  if (assignment && assignment.status !== "draft") assignment = null;
  if (!assignment) assignment = await env.DB.prepare("SELECT id,paper_id AS paperId,status FROM assignments WHERE lesson_id=? AND status='draft' AND paper_id IS NOT NULL ORDER BY id LIMIT 1").bind(lessonId).first<Record<string, any>>();
  let paperId = Number(assignment?.paperId || (!state?.assignmentId ? state?.paperId : 0) || 0), assignmentId = Number(assignment?.id || 0);
  if (!paperId) {
    const paper = await env.DB.prepare("INSERT INTO papers(title,type,stage,grade,textbook_version,status) VALUES(?,?,?,?,?,'draft') RETURNING id").bind(`${lesson.date} ${lesson.topic || lesson.courseName} 课后练习`, "练习", lesson.stage, lesson.grade, lesson.textbookVersion || null).first<{ id: number }>(); paperId = Number(paper?.id || 0);
  }
  if (!assignmentId) {
    const row = await env.DB.prepare("INSERT INTO assignments(lesson_id,paper_id,class_id,title,requirements,status) VALUES(?,?,?,?,?,'draft') RETURNING id").bind(lessonId, paperId, lesson.classId, `${lesson.topic || lesson.courseName} 课后作业`, "请按教师确认后的要求完成练习。作业当前为草稿，尚未发布。 ").first<{ id: number }>(); assignmentId = Number(row?.id || 0);
    if (assignmentId) await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO assignment_settings(assignment_id,allow_parent_submit,require_revision) VALUES(?,1,1)").bind(assignmentId),
      env.DB.prepare("INSERT OR IGNORE INTO assignment_targets(assignment_id,target_type,target_id) VALUES(?,'class',?)").bind(assignmentId, lesson.classId),
    ]);
  }
  if (!paperId || !assignmentId) return Response.json({ error: "无法创建作业草稿" }, { status: 500 });
  let added = 0;
  for (const question of active.results) {
    const exists = await env.DB.prepare("SELECT 1 FROM paper_questions WHERE paper_id=? AND question_id=?").bind(paperId, question.id).first();
    if (exists) continue;
    const position = await env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS position FROM paper_questions WHERE paper_id=?").bind(paperId).first<{ position: number }>();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO paper_questions(paper_id,question_id,position,answer_space) VALUES(?,?,?,2)").bind(paperId, question.id, Number(position?.position || 0)),
      env.DB.prepare("UPDATE questions SET use_count=use_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(question.id),
    ]); added++;
  }
  await env.DB.prepare("INSERT INTO lesson_workflow_state(lesson_id,revision,draft_payload,homework_paper_id,homework_assignment_id,updated_by) VALUES(?,0,'{}',?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET homework_paper_id=excluded.homework_paper_id,homework_assignment_id=excluded.homework_assignment_id,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").bind(lessonId, paperId, assignmentId, access.id).run();
  await audit(access, "create_homework_draft", "lesson", lessonId, { paperId, assignmentId, added });
  return Response.json({ ok: true, paperId, assignmentId, added, paperHref: `/papers/${paperId}`, assignmentHref: `/assignments?lessonId=${lessonId}&status=draft` });
}
