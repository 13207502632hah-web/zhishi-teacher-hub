import { env } from "cloudflare:workers";
import { isDenied, requirePermission } from "../../../lib/access";
import { aiErrorResponse, callDeepSeekJson, redactPrivateText, requireAiTeacher } from "../../../lib/ai/server";
import { getLearningExamples } from "../../../lib/ai/learning";

type Draft = { content?: string; shortContent?: string; standardContent?: string; learningContent?: string; highlights?: string; consolidate?: string; homeworkRequirements?: string; parentAdvice?: string; nextFocus?: string; evidenceSummary?: string[]; uncertainty?: string[] };

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access; const denied = requireAiTeacher(access); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, any>, lessonId = Number(body.lessonId || 0), studentId = Number(body.studentId || 0), audience = String(body.audience || "private"), tone = String(body.tone || "温和鼓励");
    if (!lessonId) return Response.json({ error: "请先选择关联课时，再生成 AI 草稿" }, { status: 400 });
    const lesson = await env.DB.prepare("SELECT id,date,course_name AS courseName,stage,grade,topic,knowledge_points AS knowledgePoints,actual_content AS actualContent,homework,next_plan AS nextPlan,participation,understanding,completion FROM lessons WHERE id=?").bind(lessonId).first<Record<string, any>>();
    if (!lesson) return Response.json({ error: "关联课时不存在" }, { status: 404 });
    const student = studentId ? await env.DB.prepare("SELECT id,name,grade,foundation_level AS foundationLevel,weak_knowledge AS weakKnowledge,learning_habits AS learningHabits,stage_goal AS stageGoal FROM students WHERE id=?").bind(studentId).first<Record<string, any>>() : null;
    const record = studentId ? await env.DB.prepare("SELECT participation,understanding,completion,teacher_note AS teacherNote,risk_tags AS riskTags,risk_confirmed AS riskConfirmed FROM student_lesson_records WHERE lesson_id=? AND student_id=?").bind(lessonId, studentId).first<Record<string, any>>() : null;
    const settings = await env.DB.prepare("SELECT include_student_name AS includeStudentName FROM ai_settings WHERE user_id=?").bind(access.id).first<{ includeStudentName: number }>();
    const examples = await getLearningExamples(access, audience, tone), includeName = Boolean(settings?.includeStudentName), names = student?.name ? [String(student.name)] : [];
    const input = { instruction: "请仅根据真实记录生成中文课后反馈 JSON 草稿；没有证据的结论写入 uncertainty，不得补写事实、政策或学生心理诊断。content/shortContent/standardContent 必须可直接供教师编辑，不能声称已经发送。", audience, tone, customInput: redactPrivateText(body.customInput), lesson, student: student ? { ...student, name: includeName ? student.name : "【学生】" } : null, studentLessonRecord: record, teacherStyleExamples: examples, requiredJsonKeys: ["content", "shortContent", "standardContent", "learningContent", "highlights", "consolidate", "homeworkRequirements", "parentAdvice", "nextFocus", "evidenceSummary", "uncertainty"] };
    const result = await callDeepSeekJson<Draft>({ access, feature: "feedback_draft", entityType: "lesson", entityId: lessonId, system: "你是教师后台的课后反馈草稿助手。严格输出一个 JSON 对象，不使用 Markdown。所有判断必须由输入中的课堂记录支持，敏感信息最小化。", payload: input, maxTokens: 2200 });
    const clean = Object.fromEntries(Object.entries(result.data || {}).map(([key, value]) => [key, Array.isArray(value) ? value.map((item) => redactPrivateText(item, includeName ? [] : names)) : redactPrivateText(value, includeName ? [] : names)]));
    if (!String(clean.content || "").trim()) return Response.json({ error: "AI 草稿缺少反馈正文，请重试" }, { status: 502 });
    return Response.json({ draft: clean, runId: result.runId, notice: "AI 仅生成未发布草稿，教师核对保存后才会进入反馈记录。" });
  } catch (error) { return aiErrorResponse(error); }
}
