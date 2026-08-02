import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../lib/access";
import { canConfirmRecognition, masteryLevel, REVIEW_CONFIDENCE } from "../../lib/recognition";

type RecognitionRow = Record<string, any>;

const candidateValues = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [value.trim()];
  } catch {
    return value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
  }
};

const hasUnresolvedConflict = (item: RecognitionRow) => candidateValues(item.candidates).length > 1 || /冲突|conflict/i.test(String(item.error_type || ""));

const isManuallyConfirmedItem = (item: RecognitionRow) => {
  const teacherScore = Number(item.teacher_score);
  const maxScore = Number(item.max_score);
  return item.review_status === "confirmed"
    && Boolean(String(item.question_number || "").trim())
    && Boolean(String(item.student_answer || "").trim())
    && Boolean(String(item.knowledge_points || "").trim())
    && Number.isFinite(teacherScore)
    && Number.isFinite(maxScore)
    && teacherScore >= 0
    && maxScore > 0
    && teacherScore <= maxScore
    && !hasUnresolvedConflict(item)
    && canConfirmRecognition({
      confidence: item.confidence,
      teacherScore,
      maxScore,
      reviewStatus: item.review_status,
    });
};

const scoreOf = (items: RecognitionRow[]) => items.reduce((sum, item) => sum + Number(item.teacher_score || 0), 0);

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read");
  if (isDenied(access)) return access;
  const id = Number(new URL(request.url).searchParams.get("id") || 0);
  if (id) {
    const job = await env.DB.prepare("SELECT * FROM recognition_jobs WHERE id=?").bind(id).first();
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
    const row = await env.DB.prepare("INSERT INTO recognition_jobs(assessment_id,student_id,source_asset_id,answer_asset_id,provider,stage,progress) VALUES(?,?,?,?,?,?,?) RETURNING id").bind(assessmentId, studentId, sourceAssetId, body.answerAssetId || null, "manual", "review", 0).first<{ id: number }>();
    for (const [index, item] of items.entries()) {
      await env.DB.prepare("INSERT INTO recognition_items(job_id,question_id,question_number,student_answer,standard_answer,recognized_score,teacher_score,max_score,confidence,candidates,knowledge_points,error_type,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(row?.id, item.questionId || null, String(item.questionNumber || index + 1), item.studentAnswer || null, item.standardAnswer || null, item.recognizedScore ?? null, item.teacherScore ?? null, item.maxScore ?? null, item.confidence ?? null, item.candidates ? JSON.stringify(item.candidates) : null, item.knowledgePoints || null, item.errorType || null, item.reviewStatus === "confirmed" ? "confirmed" : "pending").run();
    }
    await audit(access, "create", "recognition_job", row?.id);
    return Response.json({ id: row?.id }, { status: 201 });
  }

  const jobId = Number(body.jobId);
  if (!Number.isFinite(jobId) || jobId <= 0) return Response.json({ error: "校对任务编号无效" }, { status: 400 });

  if (action === "save") {
    const job = await env.DB.prepare("SELECT stage FROM recognition_jobs WHERE id=?").bind(jobId).first<{ stage: string }>();
    if (!job) return Response.json({ error: "校对任务不存在" }, { status: 404 });
    if (job.stage === "confirmed") return Response.json({ error: "任务已经最终确认，不能再次修改" }, { status: 409 });
    for (const item of Array.isArray(body.items) ? body.items : []) {
      await env.DB.prepare("UPDATE recognition_items SET student_answer=?,standard_answer=?,teacher_score=?,max_score=?,knowledge_points=?,error_type=?,candidates=?,review_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=?").bind(item.studentAnswer ?? item.student_answer ?? null, item.standardAnswer ?? item.standard_answer ?? null, item.teacherScore ?? item.teacher_score ?? null, item.maxScore ?? item.max_score ?? null, item.knowledgePoints ?? item.knowledge_points ?? null, item.errorType ?? item.error_type ?? null, item.candidates ? JSON.stringify(item.candidates) : null, item.reviewStatus || item.review_status || "pending", Number(item.id), jobId).run();
    }
    await env.DB.prepare("UPDATE recognition_jobs SET progress=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(body.progress || 0), jobId).run();
    return Response.json({ ok: true });
  }

  if (action === "acceptHighConfidence") {
    return Response.json({ error: "必须逐题人工确认，不能按置信度自动确认" }, { status: 409 });
  }

  if (action !== "confirm") return Response.json({ error: "不支持的操作" }, { status: 400 });

  const job = await env.DB.prepare("SELECT * FROM recognition_jobs WHERE id=?").bind(jobId).first<RecognitionRow>();
  if (!job) return Response.json({ error: "校对任务不存在" }, { status: 404 });
  const allItems = (await env.DB.prepare("SELECT * FROM recognition_items WHERE job_id=? ORDER BY CAST(question_number AS INTEGER),id").bind(jobId).all()).results as RecognitionRow[];
  if (job.stage === "confirmed") {
    return Response.json({ ok: true, alreadyConfirmed: true, score: scoreOf(allItems), count: allItems.length });
  }
  if (!job.assessment_id || !job.student_id) return Response.json({ error: "确认前必须关联测验和学生" }, { status: 400 });
  if (!allItems.length) return Response.json({ error: "至少需要一题才能确认" }, { status: 409 });
  const confirmed = allItems.filter(isManuallyConfirmedItem);
  if (confirmed.length !== allItems.length) return Response.json({ error: `仍有 ${allItems.length - confirmed.length} 题存疑，请逐题人工确认` }, { status: 409 });

  const score = scoreOf(confirmed);
  const confirmStatements = [
    env.DB.prepare("INSERT INTO assessment_results(assessment_id,student_id,score,teacher_note) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM recognition_jobs WHERE id=? AND stage!='confirmed') ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,teacher_note=excluded.teacher_note,updated_at=CURRENT_TIMESTAMP")
      .bind(job.assessment_id, job.student_id, score, "由答题卡逐题校对后确认", jobId),
  ];
  for (const item of confirmed) {
    confirmStatements.push(
      env.DB.prepare("INSERT INTO assessment_question_results(assessment_result_id,question_id,question_number,answer,score,max_score,knowledge_points,error_type,source,confirmed_at) SELECT (SELECT id FROM assessment_results WHERE assessment_id=? AND student_id=?),?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM recognition_jobs WHERE id=? AND stage!='confirmed') ON CONFLICT(assessment_result_id,question_number) DO UPDATE SET answer=excluded.answer,score=excluded.score,max_score=excluded.max_score,knowledge_points=excluded.knowledge_points,error_type=excluded.error_type,source=excluded.source,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP")
        .bind(job.assessment_id, job.student_id, item.question_id || null, item.question_number, item.student_answer, item.teacher_score, item.max_score, item.knowledge_points, item.error_type, "recognition", jobId),
    );
    const rate = Number(item.max_score) ? Number(item.teacher_score || 0) / Number(item.max_score) : 0;
    confirmStatements.push(
      env.DB.prepare("INSERT INTO knowledge_evidence(student_id,knowledge_name,level,source_type,source_id,evidence,is_manual,created_by) SELECT ?,?,?,?,(SELECT id FROM assessment_results WHERE assessment_id=? AND student_id=?),?,0,? WHERE EXISTS (SELECT 1 FROM recognition_jobs WHERE id=? AND stage!='confirmed')")
        .bind(job.student_id, item.knowledge_points, masteryLevel(rate, 1), "assessment_question", job.assessment_id, job.student_id, `题${item.question_number}：${item.teacher_score}/${item.max_score}分`, access.id, jobId),
    );
  }
  confirmStatements.push(
    env.DB.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM recognition_jobs WHERE id=? AND stage!='confirmed')")
      .bind(access.id, "confirm", "recognition_job", String(jobId), JSON.stringify({ score, count: confirmed.length }), jobId),
    env.DB.prepare("UPDATE recognition_jobs SET stage='confirmed',progress=100,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND stage!='confirmed'").bind(jobId),
  );
  const batchResults = await env.DB.batch(confirmStatements);
  const confirmationResult = batchResults.at(-1);
  if (Number(confirmationResult?.meta?.changes || 0) !== 1) {
    const currentJob = await env.DB.prepare("SELECT stage FROM recognition_jobs WHERE id=?").bind(jobId).first<{ stage: string }>();
    if (currentJob?.stage === "confirmed") {
      return Response.json({ ok: true, alreadyConfirmed: true, score, count: confirmed.length });
    }
    return Response.json({ error: "校对任务状态已变化，请重新读取后确认" }, { status: 409 });
  }
  return Response.json({ ok: true, score, count: confirmed.length });
}
