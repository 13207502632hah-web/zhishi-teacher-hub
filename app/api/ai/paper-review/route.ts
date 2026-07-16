import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { AiServiceError, aiErrorResponse, callDeepSeekJson, requireAiTeacher } from "../../../lib/ai/server";

type PaperRisk = { level: "高" | "中" | "低"; title: string; evidence: string; recommendation: string };
type PaperReview = { summary: string; strengths: string[]; risks: PaperRisk[]; recommendedActions: string[]; evidenceSummary: string[]; uncertainty: string[] };
const text = (value: unknown) => String(value || "").trim();

function validatePaperReview(value: unknown): PaperReview {
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || Array.isArray(row) || !text(row.summary)) throw new AiServiceError("AI 试卷质检结构无效，结果未采用", 502, "SCHEMA_INVALID");
  const risks = Array.isArray(row.risks) ? row.risks.slice(0, 16).map((item) => {
    const risk = item as Record<string, unknown>, level = text(risk.level);
    if (!["高", "中", "低"].includes(level) || !text(risk.title) || !text(risk.evidence) || !text(risk.recommendation)) throw new AiServiceError("AI 试卷质检风险项不完整，结果未采用", 502, "SCHEMA_INVALID");
    return { level, title: text(risk.title), evidence: text(risk.evidence), recommendation: text(risk.recommendation) } as PaperRisk;
  }) : [];
  return { summary: text(row.summary), strengths: Array.isArray(row.strengths) ? row.strengths.map(String).slice(0, 12) : [], risks, recommendedActions: Array.isArray(row.recommendedActions) ? row.recommendedActions.map(String).slice(0, 12) : [], evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary.map(String).slice(0, 20) : [], uncertainty: Array.isArray(row.uncertainty) ? row.uncertainty.map(String).slice(0, 20) : [] };
}

export async function POST(request: Request) {
  const access = await requirePermission("papers:read"); if (isDenied(access)) return access; const roleDenied = requireAiTeacher(access); if (roleDenied) return roleDenied;
  let paperId = 0;
  try {
    const body = await request.json() as Record<string, unknown>; paperId = Number(body.paperId || 0);
    if (!paperId) return Response.json({ error: "请先打开一份试卷，再运行 AI 结构质检" }, { status: 400 });
    const [paper, questionRows] = await Promise.all([
      env.DB.prepare("SELECT id,title,type,stage,grade,textbook_version AS textbookVersion,duration_minutes AS durationMinutes,total_score AS totalScore,status FROM papers WHERE id=?").bind(paperId).first<Record<string, any>>(),
      env.DB.prepare("SELECT q.id,substr(q.stem,1,600) AS stem,q.question_type AS questionType,q.difficulty,q.knowledge_points AS knowledgePoints,pq.score,pq.group_title AS groupTitle,CASE WHEN TRIM(COALESCE(q.answer,''))<>'' THEN 1 ELSE 0 END AS hasAnswer,CASE WHEN TRIM(COALESCE(q.analysis,''))<>'' THEN 1 ELSE 0 END AS hasAnalysis FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position LIMIT 120").bind(paperId).all<Record<string, any>>(),
    ]);
    if (!paper) return Response.json({ error: "试卷不存在" }, { status: 404 });
    const questions = questionRows.results;
    if (!questions.length) return Response.json({ error: "当前试卷还没有可质检的题目" }, { status: 400 });
    const sentFields = ["试卷名称、类型、学段、年级、时长和总分", "题目顺序、题干、题型、难度、分值、分组和知识点", "答案与解析是否缺失（仅布尔状态）"];
    const excludedFields = ["题目答案和解析正文", "学生与班级信息", "附件原卷与文件地址", "登录、会话和密钥数据"];
    const payload = { instruction: "严格输出 JSON。根据试卷结构检查题型、难度、知识点、分值、分组、题干相似度、预计时长和缺失字段。不得评价未提供的答案正确性，不得新增教材观点或政策事实，不得修改试卷。每条风险必须引用输入中可见的题号、数量或分布作为证据。", paper, questionCount: questions.length, questions, sentFields, excludedFields, requiredJsonExample: { summary: "字符串", strengths: ["字符串"], risks: [{ level: "高", title: "字符串", evidence: "字符串", recommendation: "字符串" }], recommendedActions: ["字符串"], evidenceSummary: ["字符串"], uncertainty: ["字符串"] } };
    const result = await callDeepSeekJson<PaperReview>({ access, feature: "paper_review", entityType: "paper", entityId: paperId, system: "你是教师组卷工作台的结构质检助手。只输出 JSON；只给证据化建议，不改题、不发布试卷。", payload, thinking: true, useProModel: false, maxTokens: 3600, validate: validatePaperReview });
    const uncertainty = [...result.data.uncertainty]; if (questions.length >= 120) uncertainty.push("本次最多质检前 120 题，请人工确认是否仍有未分析题目");
    await audit(access, "generate", "ai_paper_review", paperId, { runId: result.runId, model: result.model, questionCount: questions.length, sentFields, excludedFields });
    return Response.json({ review: { ...result.data, uncertainty }, runId: result.runId, sentFields, excludedFields, notice: "质检只提供建议，不会修改题目、分值、顺序或试卷状态。" });
  } catch (error) { await audit(access, "generate_failed", "ai_paper_review", paperId || null, { errorCode: error instanceof AiServiceError ? error.code : "UNKNOWN", message: error instanceof Error ? error.message.slice(0, 500) : "未知错误" }).catch(() => undefined); return aiErrorResponse(error); }
}
