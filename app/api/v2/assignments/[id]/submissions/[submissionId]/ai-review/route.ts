import { env, waitUntil } from "cloudflare:workers";
import { audit, isDenied, requireClassAccess, requirePermission } from "../../../../../../../lib/access";
import { callV2AiJson, V2AiError } from "../../../../../../../lib/v2/ai-router";
import { createJob, updateJob } from "../../../../../../../lib/v2/job-service";

type ReviewSuggestion = {
  outcome: "completed" | "excellent" | "revision" | "incomplete";
  suggestedScore: number | null;
  scoreBasis: string;
  reviewTags: string[];
  teacherNote: string;
  revisionRequirements: string;
  annotation: string;
  summary: string;
  evidence: Array<{ sourceType: string; sourceId: string; observation: string }>;
  uncertainty: string[];
  confidence: number;
};

const outcomes = new Set<ReviewSuggestion["outcome"]>(["completed", "excellent", "revision", "incomplete"]);
const sourceTypes = new Set(["assignment", "response", "rubric", "prior_review", "attachment_metadata"]);
const clean = (value: unknown, length: number) => String(value ?? "").trim().slice(0, length);
const list = (value: unknown, length: number, itemLength: number) => Array.isArray(value) ? value.map((item) => clean(item, itemLength)).filter(Boolean).slice(0, length) : [];

function validator(maxScore: number | null) {
  return (value: unknown): ReviewSuggestion => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2AiError("AI 批改建议不是有效对象", "SCHEMA_INVALID");
    const row = value as Record<string, unknown>, outcome = clean(row.outcome, 30) as ReviewSuggestion["outcome"];
    if (!outcomes.has(outcome)) throw new V2AiError("AI 批改结果不在允许范围内", "SCHEMA_INVALID");
    const rawScore = row.suggestedScore == null || row.suggestedScore === "" ? null : Number(row.suggestedScore);
    if (rawScore != null && (!Number.isFinite(rawScore) || rawScore < 0 || maxScore == null || rawScore > maxScore)) throw new V2AiError("AI 建议分数超出当前作业评分范围", "SCHEMA_INVALID");
    const evidence = Array.isArray(row.evidence) ? row.evidence.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}).map((item) => ({ sourceType: clean(item.sourceType, 40), sourceId: clean(item.sourceId, 80), observation: clean(item.observation, 500) })).filter((item) => sourceTypes.has(item.sourceType) && item.sourceId && item.observation).slice(0, 16) : [];
    if (!evidence.length) throw new V2AiError("AI 批改建议缺少可核对依据", "SCHEMA_INVALID");
    const confidence = Number(row.confidence);
    return {
      outcome,
      suggestedScore: rawScore,
      scoreBasis: clean(row.scoreBasis, 800),
      reviewTags: list(row.reviewTags, 10, 80),
      teacherNote: clean(row.teacherNote, 3000),
      revisionRequirements: clean(row.revisionRequirements, 3000),
      annotation: clean(row.annotation, 3000),
      summary: clean(row.summary, 1200),
      evidence,
      uncertainty: list(row.uncertainty, 10, 500),
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    };
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string; submissionId: string }> }) {
  const access = await requirePermission("lessons:write");
  if (isDenied(access)) return access;
  const params = await context.params, assignmentId = Number(params.id), submissionId = Number(params.submissionId);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0 || !Number.isInteger(submissionId) || submissionId <= 0) return Response.json({ error: "作业或提交编号无效" }, { status: 400 });

  const submission = await env.DB.prepare(`SELECT s.id,s.status,s.student_id AS studentId,st.name AS studentName,a.id AS assignmentId,a.class_id AS classId,a.paper_id AS paperId,a.title AS assignmentTitle,a.requirements,p.title AS paperTitle,p.total_score AS paperTotalScore,
    (SELECT id FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS versionId,
    (SELECT version FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS version,
    (SELECT text_content FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS responseText,
    (SELECT revision_requirements FROM submission_reviews WHERE submission_id=s.id AND status='confirmed' ORDER BY id DESC LIMIT 1) AS priorRevisionRequirements,
    (SELECT teacher_note FROM submission_reviews WHERE submission_id=s.id AND status='confirmed' ORDER BY id DESC LIMIT 1) AS priorTeacherNote
    FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id JOIN students st ON st.id=s.student_id LEFT JOIN papers p ON p.id=a.paper_id WHERE a.id=? AND s.id=?`)
    .bind(assignmentId, submissionId).first<Record<string, unknown>>();
  if (!submission) return Response.json({ error: "提交记录不存在或不属于当前作业" }, { status: 404 });
  const classId = Number(submission.classId || 0);
  if (classId) { const denied = await requireClassAccess(access, classId); if (denied) return denied; }
  else if (access.role !== "teacher") return Response.json({ error: "当前账号无权分析指定学生作业" }, { status: 403 });
  const versionId = Number(submission.versionId || 0);
  if (!versionId) return Response.json({ error: "学生尚无可批改的提交版本" }, { status: 409 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>, operationId = clean(body.operationId || request.headers.get("x-operation-id") || crypto.randomUUID(), 160);
  if (!operationId) return Response.json({ error: "operationId 不能为空" }, { status: 400 });
  const { job, repeated } = await createJob(access, { type: "submission.ai_review", operationId, entityType: "submission", entityId: submissionId, state: "running", stage: "reasoning", total: 1, payload: { assignmentId, submissionId, versionId } });
  if (repeated) {
    const ready = job.state === "completed";
    return Response.json({ job, repeated: true, ...(ready ? { review: job.result.review, model: job.result.model, provider: job.result.provider, privacy: job.result.privacy } : { error: job.state === "failed" ? clean(job.error.message, 500) || "上次分析失败，请重新生成" : "相同批改分析仍在处理中" }) }, { status: ready ? 200 : job.state === "failed" ? 409 : 202 });
  }

  waitUntil((async () => { try {
    const paperId = Number(submission.paperId || 0);
    const [rubricRows, assetRows] = await Promise.all([
      paperId ? env.DB.prepare(`SELECT q.id,pq.position,pq.score,q.stem,q.material,q.answer,q.analysis,q.answer_points AS answerPoints,q.scoring_points AS scoringPoints,q.knowledge_points AS knowledgePoints FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position LIMIT 120`).bind(paperId).all<Record<string, unknown>>() : Promise.resolve({ results: [] as Record<string, unknown>[] }),
      env.DB.prepare("SELECT fa.mime_type AS mimeType,fa.size,sa.precheck_status AS precheckStatus,sa.precheck_notes AS precheckNotes FROM submission_assets sa JOIN file_assets fa ON fa.id=sa.asset_id WHERE sa.submission_version_id=? AND fa.status='active' ORDER BY sa.position LIMIT 30").bind(versionId).all<Record<string, unknown>>(),
    ]);
    const rubrics = rubricRows.results.map((row) => ({ id: Number(row.id), position: Number(row.position), score: row.score == null ? null : Number(row.score), stem: clean(row.stem, 4000), material: clean(row.material, 3000), answer: clean(row.answer, 3000), analysis: clean(row.analysis, 3000), answerPoints: clean(row.answerPoints, 2500), scoringPoints: clean(row.scoringPoints, 2500), knowledgePoints: clean(row.knowledgePoints, 800) }));
    const summedScore = rubrics.reduce((sum, row) => sum + (Number.isFinite(Number(row.score)) ? Number(row.score) : 0), 0), paperTotal = Number(submission.paperTotalScore);
    const maxScore = Number.isFinite(paperTotal) && paperTotal > 0 ? paperTotal : summedScore > 0 ? summedScore : null;
    const attachments = assetRows.results.map((row, index) => ({ ref: `attachment-${index + 1}`, mimeType: clean(row.mimeType, 120), size: Number(row.size || 0), precheckStatus: clean(row.precheckStatus, 80), precheckNotes: clean(row.precheckNotes, 500) }));
    const result = await callV2AiJson({
      access, capability: rubrics.length ? "reasoning" : "fast", jobId: job.id, promptVersion: "submission-review-v2.1", maxTokens: 12000,
      system: "你是政治学科教师的批改副驾驶。只依据本次提供的作业要求、最新版学生文字作答、题目评分点、既往订正要求和附件元数据提出批改草稿。不得根据学生身份、既往印象或缺失内容推测答案；不得作心理或人格判断。没有可核对的总分或评分点时 suggestedScore 必须为 null。附件原件未提供时必须明确说明无法核对其内容。教师评语应具体、友善、可执行，所有结论要引用 sourceType 和 sourceId。你只能生成草稿，不能声称已经保存、发布或发送。",
      payload: {
        assignment: { id: assignmentId, title: clean(submission.assignmentTitle, 300), requirements: clean(submission.requirements, 5000), paperId: paperId || null, paperTitle: clean(submission.paperTitle, 300), maxScore },
        response: { submissionId, versionId, version: Number(submission.version || 0), text: clean(submission.responseText, 20000), attachments },
        rubric: rubrics,
        priorConfirmedReview: { teacherNote: clean(submission.priorTeacherNote, 2000), revisionRequirements: clean(submission.priorRevisionRequirements, 2000) },
        allowedOutcomes: [...outcomes],
        outputSchema: { outcome: "completed | excellent | revision | incomplete", suggestedScore: "number | null", scoreBasis: "string", reviewTags: ["string"], teacherNote: "string", revisionRequirements: "string", annotation: "string", summary: "string", evidence: [{ sourceType: "assignment | response | rubric | prior_review | attachment_metadata", sourceId: "string", observation: "string" }], uncertainty: ["string"], confidence: "0..1" },
      },
      evidence: [{ label: "作业", value: String(assignmentId) }, { label: "提交版本", value: `${submissionId}:${Number(submission.version || 0)}` }, { label: "评分题目", value: String(rubrics.length) }],
      knownNames: [clean(submission.studentName, 80)], validate: validator(maxScore),
    });
    const resultPayload = { review: result.data, model: result.model, provider: result.provider, privacy: result.privacy, submissionVersion: Number(submission.version || 0), maxScore };
    const completed = await updateJob(access, job.id, { state: "completed", stage: "draft_ready", progress: 100, processed: 1, total: 1, result: resultPayload, message: "AI 批改草稿已生成，等待教师编辑或提交确认" });
    await audit(access, "ai_review_suggest", "assignment_submission", submissionId, { assignmentId, versionId, model: result.model, provider: result.provider, confidence: result.data.confidence });
    return { job: completed, ...resultPayload, runId: result.runId };
  } catch (reason) {
    const error = reason instanceof V2AiError ? reason : new V2AiError("AI 批改建议暂时不可用", "UNKNOWN");
    await updateJob(access, job.id, { state: "failed", stage: "failed", progress: 0, error: { code: error.code, message: error.message }, message: error.message });
    return { error: error.message, code: error.code, jobId: job.id };
  } })());
  return Response.json({ job, queued: true }, { status: 202 });
}
