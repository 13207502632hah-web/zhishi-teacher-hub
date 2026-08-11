import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission, type AccessContext } from "../../../../lib/access";
import { callV2AiJson, V2AiError } from "../../../../lib/v2/ai-router";
import { createApproval } from "../../../../lib/v2/approval-service";
import { createJob, updateJob } from "../../../../lib/v2/job-service";

type AssistantAction = { actionType: string; entityType: string; entityId?: string; title: string; summary: string; confidence: number; payload: Record<string, unknown> };
type AssistantResult = { message: string; confidence: number; evidence: string[]; actions: AssistantAction[]; followUps: string[] };
const assistantActionTypes = ["schedule.adjust", "question.promote", "assignment.publish", "feedback.send", "paper.create_draft", "lesson.prepare_draft", "analysis.create_report"] as const;
const allowedActions = new Set<string>(assistantActionTypes);
const actionsRequiringEntityId = new Set(["schedule.adjust", "question.promote", "assignment.publish", "feedback.send", "lesson.prepare_draft"]);

const validate = (value: unknown): AssistantResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2AiError("助手返回结构无效", "SCHEMA_INVALID");
  const row = value as Record<string, unknown>;
  if (typeof row.message !== "string" || !row.message.trim() || !Array.isArray(row.evidence) || !Array.isArray(row.actions)) throw new V2AiError("助手缺少结论、依据或动作列表", "SCHEMA_INVALID");
  const actions = row.actions.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new V2AiError("助手动作结构无效", "SCHEMA_INVALID");
    const action = item as Record<string, unknown>;
    for (const key of ["actionType", "entityType", "title", "summary"] as const) if (typeof action[key] !== "string" || !String(action[key]).trim()) throw new V2AiError(`助手动作缺少 ${key}`, "SCHEMA_INVALID");
    if (!allowedActions.has(String(action.actionType))) throw new V2AiError(`助手返回了未授权动作 ${String(action.actionType)}`, "SCHEMA_INVALID");
    if (actionsRequiringEntityId.has(String(action.actionType)) && !/^\d+$/.test(String(action.entityId || ""))) throw new V2AiError(`动作 ${String(action.actionType)} 缺少有效业务编号`, "SCHEMA_INVALID");
    return { actionType: String(action.actionType), entityType: String(action.entityType), entityId: action.entityId == null ? undefined : String(action.entityId), title: String(action.title), summary: String(action.summary), confidence: Math.max(0, Math.min(1, Number(action.confidence || 0))), payload: action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) ? action.payload as Record<string, unknown> : {} };
  });
  return { message: row.message.trim(), confidence: Math.max(0, Math.min(1, Number(row.confidence || 0))), evidence: row.evidence.map(String).filter(Boolean).slice(0, 12), actions: actions.slice(0, 8), followUps: Array.isArray(row.followUps) ? row.followUps.map(String).filter(Boolean).slice(0, 5) : [] };
};

async function workspaceSnapshot(access: AccessContext) {
  const assistant = access.role === "assistant";
  const lessonScope = assistant ? " AND EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.user_id=? AND sca.class_id=l.class_id)" : "";
  const studentScope = assistant ? " AND EXISTS(SELECT 1 FROM enrollments e JOIN staff_class_access sca ON sca.class_id=e.class_id WHERE e.student_id=s.id AND e.status='active' AND sca.user_id=?)" : "";
  const assignmentScope = assistant ? " AND EXISTS(SELECT 1 FROM staff_class_access sca WHERE sca.user_id=? AND sca.class_id=a.class_id)" : "";
  const bind = (sql: string, scoped: boolean) => scoped ? env.DB.prepare(sql).bind(access.id) : env.DB.prepare(sql);
  const [todayLessons, overdueLessons, assignmentQueue, attention, knowledge, questions, approvals, jobs, finance, knownNameRows] = await Promise.all([
    bind(`SELECT l.id,l.start_time AS startTime,l.end_time AS endTime,l.course_name AS course,l.topic,l.status,c.name AS classLabel FROM lessons l LEFT JOIN classes c ON c.id=l.class_id WHERE l.date=date('now','localtime') AND l.status!='cancelled'${lessonScope} ORDER BY l.start_time LIMIT 24`, assistant).all<Record<string, unknown>>(),
    bind(`SELECT l.id,l.date,l.course_name AS course,l.topic,l.status FROM lessons l WHERE l.date<date('now','localtime') AND l.status IN ('draft','scheduled','makeup','rescheduled')${lessonScope} ORDER BY l.date LIMIT 20`, assistant).all<Record<string, unknown>>(),
    bind(`SELECT a.id,a.title,a.due_at AS dueAt,a.status,c.name AS classLabel,SUM(CASE WHEN s.status IN ('submitted','pending_review') THEN 1 ELSE 0 END) AS pendingReview,SUM(CASE WHEN s.status='revision' THEN 1 ELSE 0 END) AS revision FROM assignments a LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN assignment_submissions s ON s.assignment_id=a.id WHERE 1=1${assignmentScope} GROUP BY a.id ORDER BY COALESCE(a.due_at,'9999') LIMIT 24`, assistant).all<Record<string, unknown>>(),
    bind(`SELECT printf('student-%d',s.id) AS anonymousRef,s.grade,s.weak_knowledge AS weakKnowledge,s.stage_goal AS stageGoal,s.risk_tags AS riskTags FROM students s WHERE s.status='active' AND (s.risk_confirmed=1 OR COALESCE(s.weak_knowledge,'')!='')${studentScope} ORDER BY s.risk_confirmed DESC,s.updated_at DESC LIMIT 20`, assistant).all<Record<string, unknown>>(),
    bind(`SELECT aqr.knowledge_points AS knowledge,SUM(aqr.score) AS earned,SUM(aqr.max_score) AS possible,COUNT(*) AS evidenceCount FROM assessment_question_results aqr JOIN assessment_results ar ON ar.id=aqr.assessment_result_id JOIN students s ON s.id=ar.student_id WHERE COALESCE(aqr.knowledge_points,'')!=''${studentScope} GROUP BY aqr.knowledge_points HAVING SUM(aqr.max_score)>0 ORDER BY SUM(aqr.score)*1.0/SUM(aqr.max_score),COUNT(*) DESC LIMIT 15`, assistant).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) AS waitingReview,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM questions").first<Record<string, unknown>>(),
    assistant ? env.DB.prepare("SELECT COUNT(*) AS total FROM v2_approvals WHERE user_id=? AND state='pending'").bind(access.id).first<Record<string, unknown>>() : env.DB.prepare("SELECT COUNT(*) AS total FROM v2_approvals WHERE state='pending'").first<Record<string, unknown>>(),
    assistant ? env.DB.prepare("SELECT id,type,state,stage,progress,error_json AS error FROM v2_jobs WHERE user_id=? AND state IN ('failed','partial','waiting_review','running','queued') ORDER BY updated_at DESC LIMIT 20").bind(access.id).all<Record<string, unknown>>() : env.DB.prepare("SELECT id,type,state,stage,progress,error_json AS error FROM v2_jobs WHERE state IN ('failed','partial','waiting_review','running','queued') ORDER BY updated_at DESC LIMIT 20").all<Record<string, unknown>>(),
    bind(`SELECT l.id AS lessonId,l.date,l.course_name AS course,lf.expected_amount AS expectedAmount,lf.received_amount AS receivedAmount,lf.status FROM lesson_finance lf JOIN lessons l ON l.id=lf.lesson_id WHERE lf.status IN ('review','pending','underpaid','overpaid')${lessonScope} ORDER BY l.date DESC LIMIT 20`, assistant).all<Record<string, unknown>>(),
    bind(`SELECT s.name FROM students s WHERE s.status='active'${studentScope}`, assistant).all<{ name: string }>(),
  ]);
  return { knownNames: knownNameRows.results.map((item) => String(item.name || "")).filter(Boolean), snapshot: {
    scope: assistant ? "assistant_assigned_classes" : "teacher_full_workspace",
    todayLessons: todayLessons.results,
    overdueLessons: overdueLessons.results,
    assignmentQueue: assignmentQueue.results,
    anonymousAttentionProfiles: attention.results,
    weakKnowledgeEvidence: knowledge.results.map((item) => ({ ...item, masteryRate: Number(item.possible || 0) ? Number(item.earned || 0) / Number(item.possible) : null })),
    questionBank: questions,
    pendingApprovals: Number(approvals?.total || 0),
    activeJobs: jobs.results,
    financeExceptions: finance.results,
    generatedAt: new Date().toISOString(),
  } };
}

export async function POST(request: Request) {
  const access = await requirePermission("dashboard:read");
  if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, prompt = String(body.prompt || "").trim();
  if (!prompt || prompt.length > 6000) return Response.json({ error: "请输入 1—6000 字的教学任务" }, { status: 400 });
  const operationId = String(body.operationId || request.headers.get("x-operation-id") || crypto.randomUUID()), evidenceContext = await workspaceSnapshot(access), snapshot = evidenceContext.snapshot;
  const { job, repeated } = await createJob(access, { type: "assistant.run", operationId, entityType: "workspace", state: "running", stage: "reasoning", payload: { prompt }, total: 1 });
  if (repeated) {
    const ready = job.state === "completed" || job.state === "waiting_review";
    return Response.json({ job, repeated: true, ...(ready ? { response: job.result, approvals: Array.isArray(job.result.approvals) ? job.result.approvals : [], model: String(job.result.model || ""), provider: String(job.result.provider || "") } : { error: job.state === "failed" ? String(job.error.message || "上次运行失败，请从任务中心重试") : "相同任务仍在处理中" }) }, { status: ready ? 200 : job.state === "failed" ? 409 : 202 });
  }
  try {
    const result = await callV2AiJson({
      access, capability: "reasoning", jobId: job.id, promptVersion: "v2-assistant-2026-08-09.1",
      system: "你是知师研室教师工作台的总控助手。必须逐条引用工作区快照中的真实课时、作业、薄弱知识、任务或财务异常，不得把缺失数据补写成事实，不得作心理诊断。先按教学影响、截止时间和证据充分度排序，再给教师可执行建议。可以提出草稿动作，但发布作业、修改课表、题目入正式库、发送反馈等正式动作只能生成待审批动作，不能声称已执行。",
      payload: { teacherRequest: prompt, workspaceSnapshot: snapshot, allowedActionTypes: assistantActionTypes, prioritizationRules: ["优先处理已逾期且影响学生的事项", "结论必须引用具体业务编号或聚合证据", "证据不足时明确写信息不足", "建议区分今天、三天内、本周"], requiredOutput: { message: "string，包含按优先级组织的结论", confidence: 0.8, evidence: ["引用快照中可核对的业务编号、数量或比率"], actions: [{ actionType: "只能从 allowedActionTypes 选择", entityType: "string", entityId: "需要具体业务对象的动作必须填写数字编号", title: "string", summary: "string", confidence: 0.8, payload: {} }], followUps: ["string"] } },
      evidence: [{ label: "工作区快照", value: snapshot.generatedAt }], knownNames: evidenceContext.knownNames, maxTokens: 12000, validate,
    });
    const approvals = [];
    for (const action of result.data.actions) approvals.push(await createApproval(access, { jobId: job.id, ...action, evidence: result.data.evidence }));
    const completed = await updateJob(access, job.id, { state: approvals.length ? "waiting_review" : "completed", stage: approvals.length ? "approval_ready" : "completed", progress: 100, processed: 1, total: 1, result: { ...result.data, approvals, model: result.model, provider: result.provider, privacy: result.privacy }, message: approvals.length ? `已生成 ${approvals.length} 个待确认动作` : "分析完成" });
    await audit(access, "generate", "v2_assistant_run", job.id, { model: result.model, provider: result.provider, approvals: approvals.length });
    return Response.json({ job: completed, runId: result.runId, model: result.model, provider: result.provider, response: result.data, approvals, privacy: result.privacy });
  } catch (reason) {
    const error = reason instanceof V2AiError ? reason : new V2AiError("智能助手暂时不可用", "UNKNOWN");
    await updateJob(access, job.id, { state: "failed", stage: "failed", progress: 0, error: { code: error.code, message: error.message }, message: error.message });
    return Response.json({ error: error.message, code: error.code, jobId: job.id }, { status: error.status });
  }
}
