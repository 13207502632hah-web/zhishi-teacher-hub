import { env } from "cloudflare:workers";
import { audit, type AccessContext } from "../access";
import { canConfirmRecognition, masteryLevel } from "../recognition";

type RecognitionRow = Record<string, unknown>;

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
    && canConfirmRecognition({ confidence: item.confidence == null ? null : Number(item.confidence), teacherScore, maxScore, reviewStatus: String(item.review_status || "") });
};

const scoreOf = (items: RecognitionRow[]) => items.reduce((sum, item) => sum + Number(item.teacher_score || 0), 0);

export async function confirmRecognition(access: AccessContext, jobId: number) {
  const job = await env.DB.prepare("SELECT * FROM recognition_jobs WHERE id=?").bind(jobId).first<RecognitionRow>();
  if (!job) throw new Error("校对任务不存在");
  const allItems = (await env.DB.prepare("SELECT * FROM recognition_items WHERE job_id=? ORDER BY CAST(question_number AS INTEGER),id").bind(jobId).all()).results as RecognitionRow[];
  if (job.stage === "confirmed") return { ok: true, alreadyConfirmed: true, score: scoreOf(allItems), count: allItems.length };
  if (!job.assessment_id || !job.student_id) throw new Error("确认前必须关联测验和学生");
  if (!allItems.length) throw new Error("至少需要一题才能确认");
  const confirmed = allItems.filter(isManuallyConfirmedItem);
  if (confirmed.length !== allItems.length) throw new Error(`仍有 ${allItems.length - confirmed.length} 题存疑，请逐题人工确认`);

  const score = scoreOf(confirmed);
  await env.DB.prepare("INSERT INTO assessment_results(assessment_id,student_id,score,teacher_note) VALUES(?,?,?,?) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,teacher_note=excluded.teacher_note,updated_at=CURRENT_TIMESTAMP").bind(job.assessment_id, job.student_id, score, "由答题卡逐题校对后确认").run();
  const result = await env.DB.prepare("SELECT id FROM assessment_results WHERE assessment_id=? AND student_id=?").bind(job.assessment_id, job.student_id).first<{ id: number }>();
  for (const item of confirmed) {
    await env.DB.prepare("INSERT INTO assessment_question_results(assessment_result_id,question_id,question_number,answer,score,max_score,knowledge_points,error_type,source,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(assessment_result_id,question_number) DO UPDATE SET answer=excluded.answer,score=excluded.score,max_score=excluded.max_score,knowledge_points=excluded.knowledge_points,error_type=excluded.error_type,source=excluded.source,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP").bind(result?.id, item.question_id || null, item.question_number, item.student_answer, item.teacher_score, item.max_score, item.knowledge_points, item.error_type, "recognition").run();
    const rate = Number(item.max_score) ? Number(item.teacher_score || 0) / Number(item.max_score) : 0;
    await env.DB.prepare("INSERT INTO knowledge_evidence(student_id,knowledge_name,level,source_type,source_id,evidence,is_manual,created_by) VALUES(?,?,?,?,?,?,0,?)").bind(job.student_id, item.knowledge_points, masteryLevel(rate, 1), "assessment_question", result?.id, `题${item.question_number}：${item.teacher_score}/${item.max_score}分`, access.id).run();
  }
  await env.DB.prepare("UPDATE recognition_jobs SET stage='confirmed',progress=100,confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(jobId).run();
  await audit(access, "confirm", "recognition_job", jobId, { score, count: confirmed.length });
  return { ok: true, score, count: confirmed.length };
}
