import { env, waitUntil } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import { REVIEW_CONFIDENCE } from "../../../lib/recognition";
import { callV2AiJson, V2AiError } from "../../../lib/v2/ai-router";
import { createJob, getJob, updateJob } from "../../../lib/v2/job-service";

const concise = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
const imageDataUrl = async (body: ReadableStream, mime: string) => { const bytes = new Uint8Array(await new Response(body).arrayBuffer()); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return `data:${mime};base64,${btoa(binary)}`; };

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read");
  if (isDenied(access)) return access;
  const id = Number(new URL(request.url).searchParams.get("id") || 0);
  if (id) {
    const job = await env.DB.prepare("SELECT rj.*,fa.original_name AS sourceName,fa.mime_type AS sourceMimeType FROM recognition_jobs rj JOIN file_assets fa ON fa.id=rj.source_asset_id WHERE rj.id=?").bind(id).first();
    const items = (await env.DB.prepare("SELECT * FROM recognition_items WHERE job_id=? ORDER BY CAST(question_number AS INTEGER),id").bind(id).all()).results;
    return Response.json({ job, items, threshold: REVIEW_CONFIDENCE });
  }
  const rows = await env.DB.prepare("SELECT rj.*,s.name AS studentName,a.title AS assessmentTitle,fa.original_name AS sourceName FROM recognition_jobs rj LEFT JOIN students s ON s.id=rj.student_id LEFT JOIN assessments a ON a.id=rj.assessment_id JOIN file_assets fa ON fa.id=rj.source_asset_id ORDER BY rj.id DESC LIMIT 50").all();
  return Response.json({ jobs: rows.results });
}

export async function POST(request: Request) {
  const access = await requirePermission("analytics:write");
  if (isDenied(access)) return access;
  const body = await request.json() as Record<string, any>;
  const action = String(body.action || "create");

  if (action === "create") {
    const assessmentId = Number(body.assessmentId);
    const studentId = Number(body.studentId);
    const sourceAssetId = Number(body.sourceAssetId);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!Number.isFinite(assessmentId) || assessmentId <= 0 || !Number.isFinite(studentId) || studentId <= 0 || !Number.isFinite(sourceAssetId) || sourceAssetId <= 0) {
      return Response.json({ error: "创建校对任务必须关联学生、测验和原图" }, { status: 400 });
    }
    if (!items.length) return Response.json({ error: "至少需要一题才能保存校对任务" }, { status: 400 });
    const source = await env.DB.prepare("SELECT id FROM file_assets WHERE id=? AND status='active' AND mime_type IN ('image/jpeg','image/png','image/webp') AND created_by=?").bind(sourceAssetId, access.id).first();
    if (!source) return Response.json({ error: "答题卡原图不存在、格式不受支持或无权使用" }, { status: 403 });
    const relation = await env.DB.prepare("SELECT a.id FROM assessments a JOIN enrollments e ON e.class_id=a.class_id AND e.student_id=? AND e.status='active' JOIN students s ON s.id=e.student_id AND s.status='active' WHERE a.id=?").bind(studentId, assessmentId).first();
    if (!relation) return Response.json({ error: "所选学生不属于该测评班级" }, { status: 400 });
    const row = await env.DB.prepare("INSERT INTO recognition_jobs(assessment_id,student_id,source_asset_id,answer_asset_id,provider,stage,progress) VALUES(?,?,?,?,?,?,?) RETURNING id").bind(assessmentId, studentId, sourceAssetId, body.answerAssetId || null, "manual", "review", 0).first<{ id: number }>();
    for (const [index, item] of items.entries()) {
      await env.DB.prepare("INSERT INTO recognition_items(job_id,question_id,question_number,student_answer,standard_answer,recognized_score,teacher_score,max_score,confidence,candidates,knowledge_points,error_type,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(row?.id, item.questionId || null, String(item.questionNumber || index + 1), item.studentAnswer || null, item.standardAnswer || null, item.recognizedScore ?? null, item.teacherScore ?? null, item.maxScore ?? null, item.confidence ?? null, item.candidates ? JSON.stringify(item.candidates) : null, item.knowledgePoints || null, item.errorType || null, item.reviewStatus === "confirmed" ? "confirmed" : "pending").run();
    }
    await audit(access, "create", "recognition_job", row?.id);
    return Response.json({ id: row?.id }, { status: 201 });
  }

  const jobId = Number(body.jobId);
  if (!Number.isFinite(jobId) || jobId <= 0) return Response.json({ error: "校对任务编号无效" }, { status: 400 });

  if (action === "aiRecognize") {
    if (body.realNameContextConfirmed !== true) return Response.json({ error: "答题卡原图可能包含姓名，调用外部视觉模型前需要本次单独确认" }, { status: 428 });
    const job = await env.DB.prepare(`SELECT rj.id,rj.stage,rj.source_asset_id AS sourceAssetId,rj.assessment_id AS assessmentId,rj.student_id AS studentId,s.name AS studentName,a.paper_id AS paperId,a.total_score AS assessmentTotal,fa.storage_key AS storageKey,fa.mime_type AS mimeType,fa.size
      FROM recognition_jobs rj JOIN students s ON s.id=rj.student_id JOIN assessments a ON a.id=rj.assessment_id JOIN file_assets fa ON fa.id=rj.source_asset_id AND fa.status='active' WHERE rj.id=?`).bind(jobId).first<Record<string, unknown>>();
    if (!job) return Response.json({ error: "校对任务、学生、测评或原图不存在" }, { status: 404 });
    if (String(job.stage) === "confirmed") return Response.json({ error: "任务已经最终确认，不能重新识别" }, { status: 409 });
    if (!String(job.mimeType || "").match(/^(image\/(?:png|jpeg|jpg|webp)|application\/pdf)$/i) || Number(job.size || 0) > 8 * 1024 * 1024) return Response.json({ error: "AI 识别仅支持 8MB 内的 PNG、JPG、WEBP 或 PDF" }, { status: 400 });
    const operationId = concise(body.operationId || request.headers.get("x-operation-id") || crypto.randomUUID(), 160), created = await createJob(access, { type: "recognition.ai", operationId, entityType: "recognition_job", entityId: jobId, state: "running", stage: "vision", total: 1, payload: { jobId, sourceAssetId: Number(job.sourceAssetId), realNameContextConfirmed: true } });
    if (created.repeated) { const ready = created.job.state === "completed"; return Response.json({ job: created.job, repeated: true, ...(ready ? created.job.result : { error: created.job.state === "failed" ? String(created.job.error.message || "上次识别失败，请重新尝试") : "相同识别任务仍在处理中" }) }, { status: ready ? 200 : created.job.state === "failed" ? 409 : 202 }); }
    waitUntil((async () => { try {
      const object = await env.FILES.get(String(job.storageKey)); if (!object) throw new V2AiError("答题卡原文件内容不存在", "SOURCE_MISSING", 404);
      const paperId = Number(job.paperId || 0), rubricRows = paperId ? await env.DB.prepare("SELECT q.id,pq.position,pq.score,q.stem,q.answer,q.analysis,q.scoring_points AS scoringPoints,q.knowledge_points AS knowledgePoints FROM paper_questions pq JOIN questions q ON q.id=pq.question_id WHERE pq.paper_id=? ORDER BY pq.position LIMIT 200").bind(paperId).all<Record<string, unknown>>() : { results: [] as Record<string, unknown>[] }, rubrics = rubricRows.results.map((row) => ({ id: Number(row.id), position: Number(row.position), score: row.score == null ? null : Number(row.score), stem: concise(row.stem, 2500), answer: concise(row.answer, 1800), analysis: concise(row.analysis, 1800), scoringPoints: concise(row.scoringPoints, 1800), knowledgePoints: concise(row.knowledgePoints, 500) })), byNumber = new Map(rubrics.map((row) => [String(row.position), row]));
      const ai = await callV2AiJson({ access, capability: "vision", jobId: created.job.id, promptVersion: "answer-card-recognition-v2.1", maxTokens: 16000,
        system: "你是政治学科答题卡识别与评分草稿助手。逐题转写学生实际作答，并仅依据给定评分点提出 recognizedScore 草稿；看不清时保留 candidates 并降低 confidence，不得猜测。不得输出学生姓名、联系方式或身份信息。结果只进入逐题人工校对，不得声称已经确认成绩。",
        payload: { recognitionJobId: jobId, assessment: { id: Number(job.assessmentId), totalScore: Number(job.assessmentTotal || 0), paperId: paperId || null }, rubric: rubrics, requiredOutput: { items: [{ questionNumber: "对应 rubric.position", studentAnswer: "string", recognizedScore: "number|null", confidence: "0..1", candidates: ["string"], errorType: "string" }] } }, images: [await imageDataUrl(object.body, String(job.mimeType))], knownNames: [String(job.studentName || "")], evidence: [{ label: "答题卡原件", value: String(job.sourceAssetId) }, { label: "评分题目", value: String(rubrics.length) }],
        validate(value) { const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; if (!Array.isArray(raw.items)) throw new V2AiError("视觉模型未返回逐题结果", "SCHEMA_INVALID"); const items = raw.items.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {}).map((item) => { const questionNumber = concise(item.questionNumber, 40), rubric = byNumber.get(questionNumber), score = item.recognizedScore == null || item.recognizedScore === "" ? null : Number(item.recognizedScore), maxScore = rubric?.score == null ? null : Number(rubric.score); return { questionNumber, studentAnswer: concise(item.studentAnswer, 8000), recognizedScore: score != null && Number.isFinite(score) && score >= 0 && maxScore != null && score <= maxScore ? score : null, maxScore, confidence: Math.max(0, Math.min(1, Number(item.confidence || 0))), candidates: Array.isArray(item.candidates) ? item.candidates.map((candidate) => concise(candidate, 1000)).filter(Boolean).slice(0, 8) : [], errorType: concise(item.errorType, 500), standardAnswer: rubric?.answer || "", knowledgePoints: rubric?.knowledgePoints || "", questionId: rubric?.id || null }; }).filter((item) => item.questionNumber && item.studentAnswer && (!rubrics.length || byNumber.has(item.questionNumber))).slice(0, 200); if (!items.length) throw new V2AiError("视觉模型没有返回可核对的题目", "SCHEMA_INVALID"); return { items }; },
      });
      const current = await getJob(access, created.job.id); if (current?.cancelRequested) { await updateJob(access, created.job.id, { state: "cancelled", stage: "cancelled", progress: current.progress, message: "任务已按请求取消，未写入识别草稿" }); return { cancelled: true }; }
      let updated = 0, createdItems = 0, preserved = 0;
      for (const item of ai.data.items) {
        const existing = await env.DB.prepare("SELECT id,review_status AS reviewStatus FROM recognition_items WHERE job_id=? AND question_number=? ORDER BY id LIMIT 1").bind(jobId, item.questionNumber).first<{ id: number; reviewStatus: string }>();
        if (existing?.reviewStatus === "confirmed") { preserved++; continue; }
        const candidates = item.candidates.length ? JSON.stringify(item.candidates) : null;
        if (existing) { await env.DB.prepare("UPDATE recognition_items SET question_id=?,student_answer=?,standard_answer=?,recognized_score=?,max_score=?,confidence=?,candidates=?,knowledge_points=?,error_type=?,review_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.questionId, item.studentAnswer, item.standardAnswer || null, item.recognizedScore, item.maxScore, item.confidence, candidates, item.knowledgePoints || null, item.errorType || null, existing.id).run(); updated++; }
        else { await env.DB.prepare("INSERT INTO recognition_items(job_id,question_id,question_number,student_answer,standard_answer,recognized_score,max_score,confidence,candidates,knowledge_points,error_type,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending')").bind(jobId, item.questionId, item.questionNumber, item.studentAnswer, item.standardAnswer || null, item.recognizedScore, item.maxScore, item.confidence, candidates, item.knowledgePoints || null, item.errorType || null).run(); createdItems++; }
      }
      const result = { recognized: ai.data.items.length, updated, created: createdItems, preservedConfirmed: preserved, model: ai.model, provider: ai.provider, privacy: ai.privacy };
      await env.DB.prepare("UPDATE recognition_jobs SET provider=?,stage='review',progress=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(`${ai.provider}:${ai.model}`, Math.min(90, Math.max(15, Math.round(ai.data.items.length / Math.max(1, rubrics.length || ai.data.items.length) * 70))), jobId).run();
      const completedJob = await updateJob(access, created.job.id, { state: "completed", stage: "review", progress: 100, processed: 1, total: 1, result, message: "AI 识别草稿已写入逐题校对区" });
      await audit(access, "ai_recognize", "recognition_job", jobId, { ...result, realNameContextConfirmed: true });
      return { job: completedJob, ...result, runId: ai.runId };
    } catch (reason) {
      const error = reason instanceof V2AiError ? reason : new V2AiError(reason instanceof Error ? reason.message : "AI 识别失败", "UNKNOWN");
      await env.DB.prepare("UPDATE recognition_jobs SET stage='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run(); await updateJob(access, created.job.id, { state: "failed", stage: "vision", progress: 0, error: { code: error.code, message: error.message }, message: error.message });
      return { error: error.message, code: error.code, jobId: created.job.id };
    } })());
    return Response.json({ job: created.job, queued: true }, { status: 202 });
  }

  if (action === "save") {
    const job = await env.DB.prepare("SELECT stage FROM recognition_jobs WHERE id=?").bind(jobId).first<{ stage: string }>();
    if (!job) return Response.json({ error: "校对任务不存在" }, { status: 404 });
    if (job.stage === "confirmed") return Response.json({ error: "任务已经最终确认，不能再次修改" }, { status: 409 });
    for (const item of (Array.isArray(body.items) ? body.items : []).slice(0, 200)) {
      const candidates = item.candidates == null ? null : Array.isArray(item.candidates) ? JSON.stringify(item.candidates) : String(item.candidates).trim() || null;
      const itemId = Number(item.id), existing = await env.DB.prepare("SELECT crop_asset_id AS cropAssetId FROM recognition_items WHERE id=? AND job_id=?").bind(itemId, jobId).first<{ cropAssetId: number | null }>();
      if (!existing) continue;
      const questionNumber = String(item.questionNumber ?? item.question_number ?? "").trim().slice(0, 40);
      if (!questionNumber) return Response.json({ error: "逐题校对结果不能缺少题号" }, { status: 400 });
      const rawCrop = item.cropAssetId ?? item.crop_asset_id ?? existing.cropAssetId, cropAssetId = rawCrop == null || rawCrop === "" ? null : Number(rawCrop);
      if (cropAssetId !== null && (!Number.isInteger(cropAssetId) || cropAssetId < 1)) return Response.json({ error: `题目 ${item.questionNumber || item.question_number || itemId} 的裁切图编号无效` }, { status: 400 });
      if (cropAssetId !== null && cropAssetId !== Number(existing.cropAssetId || 0)) {
        const asset = await env.DB.prepare("SELECT id FROM file_assets WHERE id=? AND status='active' AND mime_type LIKE 'image/%' AND created_by=?").bind(cropAssetId, access.id).first();
        if (!asset) return Response.json({ error: `题目 ${item.questionNumber || item.question_number || itemId} 的裁切图不存在或无权使用` }, { status: 403 });
      }
      await env.DB.prepare("UPDATE recognition_items SET question_number=?,student_answer=?,standard_answer=?,teacher_score=?,max_score=?,knowledge_points=?,error_type=?,candidates=?,crop_asset_id=?,review_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=?").bind(questionNumber, item.studentAnswer ?? item.student_answer ?? null, item.standardAnswer ?? item.standard_answer ?? null, item.teacherScore ?? item.teacher_score ?? null, item.maxScore ?? item.max_score ?? null, item.knowledgePoints ?? item.knowledge_points ?? null, item.errorType ?? item.error_type ?? null, candidates, cropAssetId, item.reviewStatus || item.review_status || "pending", itemId, jobId).run();
    }
    await env.DB.prepare("UPDATE recognition_jobs SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(body.progress || 0), jobId).run();
    return Response.json({ ok: true });
  }

  if (action === "acceptHighConfidence") {
    return Response.json({ error: "必须逐题人工确认，不能按置信度自动确认" }, { status: 409 });
  }

  return Response.json({ error: "不支持的操作；正式成绩确认必须进入待确认中心" }, { status: 400 });
}
