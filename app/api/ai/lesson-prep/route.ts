import { env } from "cloudflare:workers";
import { audit, isDenied, requireLessonAccess, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher, sanitizeForAi } from "../../../lib/ai/server";

type LessonPrepDraft = {
  teachingGoals: string;
  keyPoints: string;
  difficultPoints: string;
  materials: string;
  lessonFlow: string;
  questionUsePlan: string;
  evidenceSummary: string[];
  uncertainty: string[];
};

const requiredText = ["teachingGoals", "keyPoints", "difficultPoints", "materials", "lessonFlow", "questionUsePlan"] as const;
const text = (value: unknown) => String(value || "").trim();

function validateDraft(value: unknown): LessonPrepDraft {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new AiServiceError("AI 备课草案结构无效，结果未采用", 502, "SCHEMA_INVALID");
  for (const key of requiredText) if (typeof row[key] !== "string" || !text(row[key])) throw new AiServiceError(`AI 备课草案缺少“${key}”，结果未采用`, 502, "SCHEMA_INVALID");
  return { ...Object.fromEntries(requiredText.map((key) => [key, text(row[key])])), evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary.map(String).slice(0, 20) : [], uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty.map(String).slice(0, 20) : [] } as LessonPrepDraft;
}

export async function POST(request: Request) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access; const roleDenied = requireAiTeacher(access); if (roleDenied) return roleDenied;
  let lessonId = 0;
  try {
    const body = await request.json() as Record<string, unknown>; lessonId = Number(body.lessonId || 0);
    if (!lessonId) return Response.json({ error: "请先打开一节课，再生成 AI 备课草案" }, { status: 400 });
    const accessDenied = await requireLessonAccess(access, lessonId); if (accessDenied) return accessDenied;
    const lesson = await env.DB.prepare("SELECT l.id,l.class_id AS classId,l.date,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS courseName,l.stage,l.grade,l.textbook_version AS textbookVersion,l.volume,l.unit,l.topic,l.knowledge_points AS knowledgePoints,l.teaching_goals AS teachingGoals,l.key_points AS keyPoints,l.difficult_points AS difficultPoints,l.materials,c.course_type AS courseType FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.id=?").bind(lessonId).first<Record<string, any>>();
    if (!lesson) return Response.json({ error: "课时不存在" }, { status: 404 });
    const previous = lesson.classId ? await env.DB.prepare("SELECT id,date,topic,actual_content AS actualContent,next_plan AS nextPlan,participation,understanding,completion FROM lessons WHERE class_id=? AND status='completed' AND (date<? OR (date=? AND COALESCE(start_time,'')<COALESCE(?,''))) ORDER BY date DESC,start_time DESC,id DESC LIMIT 1").bind(lesson.classId, lesson.date, lesson.date, lesson.startTime || "").first<Record<string, any>>() : null;
    const [reflection, assignments, attention, linkedQuestions, studentNames] = await Promise.all([
      previous ? env.DB.prepare("SELECT difficulties,next_action AS nextAction,action_completed AS actionCompleted,student_evidence AS studentEvidence FROM reflections WHERE lesson_id=? ORDER BY updated_at DESC LIMIT 1").bind(previous.id).first<Record<string, any>>() : null,
      lesson.classId ? env.DB.prepare("SELECT a.title,a.requirements,a.due_at AS dueAt,COUNT(*) AS pendingCount FROM assignments a JOIN assignment_submissions s ON s.assignment_id=a.id WHERE a.class_id=? AND s.status NOT IN ('completed','corrected') GROUP BY a.id ORDER BY a.due_at LIMIT 12").bind(lesson.classId).all<Record<string, any>>() : Promise.resolve({ results: [] as Record<string, any>[] }),
      lesson.classId ? env.DB.prepare("SELECT COALESCE(NULLIF(r.risk_tags,''),s.risk_tags) AS reason,COUNT(*) AS studentCount FROM enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN student_lesson_records r ON r.student_id=s.id AND r.risk_confirmed=1 LEFT JOIN lessons rl ON rl.id=r.lesson_id WHERE e.class_id=? AND e.status='active' AND s.status='active' AND (s.risk_confirmed=1 OR (r.risk_confirmed=1 AND rl.date BETWEEN date(?,'-27 day') AND ?)) GROUP BY reason ORDER BY studentCount DESC").bind(lesson.classId, lesson.date, lesson.date).all<Record<string, any>>() : Promise.resolve({ results: [] as Record<string, any>[] }),
      env.DB.prepare("SELECT q.id,q.stem,q.question_type AS questionType,q.difficulty,q.knowledge_points AS knowledgePoints,lq.purpose FROM lesson_questions lq JOIN questions q ON q.id=lq.question_id WHERE lq.lesson_id=? AND q.status='active' ORDER BY lq.position,q.id LIMIT 20").bind(lessonId).all<Record<string, any>>(),
      env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>(),
    ]);
    const sentFields = ["课时日期、时间、课程类型与课程名称", "学段、年级、教材目录、课题和已有知识点", ...(lesson.teachingGoals || lesson.keyPoints || lesson.difficultPoints || lesson.materials ? ["当前备课表单"] : []), ...(previous ? ["上一节实际内容、课堂评分和下节计划"] : []), ...(reflection ? ["上一节教师反思"] : []), ...(assignments.results.length ? ["未完成作业汇总"] : []), ...(attention.results.length ? ["匿名关注事项汇总"] : []), ...(linkedQuestions.results.length ? ["已关联正式题目的题干、题型、难度和知识点"] : [])];
    const excludedFields = ["学生姓名和联系方式", "家长与微信标识", "附件原件与文件地址", "登录、会话和密钥数据"];
    const payload = sanitizeForAi({ instruction: "严格输出 JSON。只根据输入中的真实课时、上一节记录、教师反思、作业汇总和已关联题目整理备课草案。不得新增政策事实、时政材料、教材观点、知识点或标准答案；没有依据必须写‘信息不足’。lessonFlow 只给教学活动流程，questionUsePlan 只引用输入中已关联的题目。所有内容均为待教师确认的草稿。", lesson, previousLesson: previous, previousReflection: reflection, pendingAssignments: assignments.results, anonymousAttentionSummary: attention.results, linkedQuestions: linkedQuestions.results, sentFields, excludedFields, requiredJsonExample: { teachingGoals: "字符串", keyPoints: "字符串", difficultPoints: "字符串", materials: "字符串", lessonFlow: "字符串", questionUsePlan: "字符串", evidenceSummary: ["字符串"], uncertainty: ["字符串"] } }, studentNames.results.map((item) => String(item.name)));
    const result = await callDeepSeekJson<LessonPrepDraft>({ access, feature: "lesson_prep", entityType: "lesson", entityId: lessonId, system: "你是教师后台的备课草案助手。只输出 JSON；不编造政治事实、教材观点或学生结论，不自动保存。", payload, thinking: true, useProModel: false, maxTokens: 3400, validate: validateDraft });
    const draft = { ...result.data }, uncertainty = [...draft.uncertainty];
    if (!text(lesson.topic) && !text(lesson.knowledgePoints)) {
      draft.teachingGoals = "信息不足"; draft.keyPoints = "信息不足"; draft.difficultPoints = "信息不足";
      uncertainty.push("课时缺少课题和已有知识点，目标、重点和难点未生成");
    }
    if (!linkedQuestions.results.length) { draft.questionUsePlan = "信息不足"; uncertainty.push("本课时尚未关联正式题目，未生成题目使用方案"); }
    await audit(access, "generate", "ai_lesson_prep", lessonId, { runId: result.runId, model: result.model, sentFields, excludedFields });
    return Response.json({ draft: { ...draft, uncertainty }, runId: result.runId, sentFields, excludedFields, notice: "AI 备课草案尚未写入课时；点击采用后仍需教师检查并手动保存。" });
  } catch (error) { await audit(access, "generate_failed", "ai_lesson_prep", lessonId || null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
