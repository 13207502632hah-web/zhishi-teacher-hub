import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../../lib/access";

const lessonId = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);
const text = (value: unknown) => String(value || "").trim();
const tokens = (value: unknown) => text(value).split(/[、,，;；/\s]+/).map((item) => item.trim()).filter(Boolean);
const overlap = (left: unknown, right: unknown) => { const a = tokens(left), b = tokens(right); return a.some((item) => b.some((candidate) => candidate.includes(item) || item.includes(candidate))); };

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:read"); if (isDenied(access)) return access;
  const id = await lessonId(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const lesson = await env.DB.prepare("SELECT id,class_id AS classId,date,start_time AS startTime,course_name AS courseName,stage,grade,textbook_version AS textbookVersion,volume,unit,topic,knowledge_points AS knowledgePoints,teaching_goals AS teachingGoals,key_points AS keyPoints,difficult_points AS difficultPoints,materials,status FROM lessons WHERE id=?").bind(id).first<Record<string, any>>();
  if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
  const previous = lesson.classId ? await env.DB.prepare("SELECT id,date,start_time AS startTime,course_name AS courseName,topic,actual_content AS actualContent,next_plan AS nextPlan FROM lessons WHERE class_id=? AND status='completed' AND (date<? OR (date=? AND COALESCE(start_time,'')<COALESCE(?,''))) ORDER BY date DESC,start_time DESC,id DESC LIMIT 1").bind(lesson.classId, lesson.date, lesson.date, lesson.startTime || "").first<Record<string, any>>() : null;
  const [reflection, assignments, attention, candidates, linked] = await Promise.all([
    previous && access.role === "teacher" ? env.DB.prepare("SELECT difficulties,next_action AS nextAction,action_completed AS actionCompleted,student_evidence AS studentEvidence FROM reflections WHERE lesson_id=? ORDER BY updated_at DESC LIMIT 1").bind(previous.id).first<Record<string, any>>() : null,
    lesson.classId ? env.DB.prepare("SELECT a.id,a.title,a.due_at AS dueAt,COUNT(*) AS pendingCount FROM assignments a JOIN assignment_submissions s ON s.assignment_id=a.id WHERE a.class_id=? AND s.status NOT IN ('completed','corrected') GROUP BY a.id ORDER BY CASE WHEN a.due_at IS NULL OR a.due_at='' THEN 1 ELSE 0 END,a.due_at LIMIT 12").bind(lesson.classId).all() : Promise.resolve({ results: [] }),
    lesson.classId ? env.DB.prepare("SELECT DISTINCT s.id,s.name,s.grade,COALESCE(NULLIF(r.risk_tags,''),s.risk_tags) AS reason,COALESCE(r.updated_at,s.updated_at) AS updatedAt FROM enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN student_lesson_records r ON r.student_id=s.id AND r.risk_confirmed=1 LEFT JOIN lessons rl ON rl.id=r.lesson_id WHERE e.class_id=? AND e.status='active' AND s.status='active' AND (s.risk_confirmed=1 OR (r.risk_confirmed=1 AND rl.date>=date(?,'-27 day'))) ORDER BY updatedAt DESC LIMIT 12").bind(lesson.classId, lesson.date).all() : Promise.resolve({ results: [] }),
    env.DB.prepare("SELECT id,stem,question_type AS questionType,difficulty,stage,grade,textbook_version AS textbookVersion,volume,unit,topic,knowledge_points AS knowledgePoints,use_count AS useCount,updated_at AS updatedAt FROM questions WHERE status='active' AND stage=? AND grade=? ORDER BY use_count ASC,updated_at DESC LIMIT 400").bind(lesson.stage, lesson.grade).all<Record<string, any>>(),
    env.DB.prepare("SELECT question_id AS questionId FROM lesson_questions WHERE lesson_id=?").bind(id).all<{ questionId: number }>(),
  ]);
  const linkedIds = new Set(linked.results.map((item) => Number(item.questionId)));
  const recommendedQuestions = (candidates.results as Array<Record<string, any>>).filter((question) => {
    if (linkedIds.has(Number(question.id))) return false;
    if (lesson.textbookVersion && question.textbookVersion && lesson.textbookVersion !== question.textbookVersion) return false;
    if (lesson.volume && question.volume && lesson.volume !== question.volume) return false;
    const lessonHasTopic = Boolean(text(lesson.topic) || text(lesson.knowledgePoints));
    return !lessonHasTopic || overlap(lesson.topic, question.topic) || overlap(lesson.knowledgePoints, question.knowledgePoints);
  }).map((question): Record<string, any> => {
    let score = 0; const reasons: string[] = [];
    if (lesson.textbookVersion && lesson.textbookVersion === question.textbookVersion) { score += 30; reasons.push("教材版本一致"); }
    if (lesson.volume && lesson.volume === question.volume) { score += 20; reasons.push("册别一致"); }
    if (lesson.unit && lesson.unit === question.unit) { score += 15; reasons.push("单元一致"); }
    if (overlap(lesson.topic, question.topic)) { score += 20; reasons.push("课题匹配"); }
    if (overlap(lesson.knowledgePoints, question.knowledgePoints)) { score += 15; reasons.push("知识点匹配"); }
    return { ...question, score, reasons };
  }).filter((question) => question.score > 0).sort((a, b) => b.score - a.score || Number(a.useCount) - Number(b.useCount) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20);
  return Response.json({ lesson, previousLesson: previous, previousReflection: reflection || null, pendingAssignments: assignments.results, attentionStudents: attention.results, recommendedQuestions });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const id = await lessonId(context), denied = await requireLessonAccess(access, id); if (denied) return denied;
  const body = await request.json() as Record<string, unknown>;
  await env.DB.prepare("UPDATE lessons SET teaching_goals=?,key_points=?,difficult_points=?,materials=?,knowledge_points=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(text(body.teachingGoals), text(body.keyPoints), text(body.difficultPoints), text(body.materials), text(body.knowledgePoints), id).run();
  await audit(access, "save_prep", "lesson", id, { fields: ["teachingGoals", "keyPoints", "difficultPoints", "materials", "knowledgePoints"] });
  return Response.json({ ok: true });
}
