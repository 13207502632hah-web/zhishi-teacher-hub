import { env } from "cloudflare:workers";

export async function loadAiUsage(userId: number) {
  const [today, month, byFeature, byModel, runFailures, accessFailures, pendingFeedback, pendingQuestions] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS calls,COALESCE(SUM(total_tokens),0) AS tokens,COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd FROM ai_runs WHERE user_id=? AND date(datetime(created_at,'+8 hours'))=date(datetime('now','+8 hours'))").bind(userId).first(),
    env.DB.prepare("SELECT COUNT(*) AS calls,COALESCE(SUM(total_tokens),0) AS tokens,COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd FROM ai_runs WHERE user_id=? AND strftime('%Y-%m',datetime(created_at,'+8 hours'))=strftime('%Y-%m',datetime('now','+8 hours'))").bind(userId).first(),
    env.DB.prepare("SELECT feature,COUNT(*) AS calls,COALESCE(SUM(total_tokens),0) AS tokens,COALESCE(SUM(estimated_cost_usd),0) AS estimatedCostUsd FROM ai_runs WHERE user_id=? AND strftime('%Y-%m',datetime(created_at,'+8 hours'))=strftime('%Y-%m',datetime('now','+8 hours')) GROUP BY feature ORDER BY calls DESC").bind(userId).all(),
    env.DB.prepare("SELECT model,COUNT(*) AS calls,COALESCE(SUM(total_tokens),0) AS tokens FROM ai_runs WHERE user_id=? AND strftime('%Y-%m',datetime(created_at,'+8 hours'))=strftime('%Y-%m',datetime('now','+8 hours')) GROUP BY model ORDER BY calls DESC").bind(userId).all(),
    env.DB.prepare("SELECT id,feature,model,error_code AS errorCode,error_message AS errorMessage,created_at AS createdAt FROM ai_runs WHERE user_id=? AND status='failed' ORDER BY created_at DESC LIMIT 20").bind(userId).all(),
    env.DB.prepare("SELECT id,entity_type AS feature,NULL AS model,json_extract(detail,'$.errorCode') AS errorCode,json_extract(detail,'$.message') AS errorMessage,created_at AS createdAt FROM audit_logs WHERE user_id=? AND action='generate_failed' AND entity_type IN ('ai_feedback_draft','ai_question_review_task','ai_lesson_prep','ai_paper_review','ai_reflection_draft','ai_wrong_question_remediation','ai_schedule_reschedule') AND json_extract(detail,'$.errorCode') IN ('AI_NOT_CONFIGURED','AI_DISABLED','PRIVACY_ACK_REQUIRED','DAILY_LIMIT','QUESTION_MISSING','TASK_BUSY','TASK_STATE_CHANGED','SCHEMA_INVALID','HTTP_401','HTTP_402','HTTP_429','NETWORK_ERROR') ORDER BY created_at DESC LIMIT 20").bind(userId).all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM ai_feedback_drafts WHERE user_id=? AND status='pending'").bind(userId).first<{ count: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM ai_question_reviews r JOIN ai_runs ar ON ar.id=r.run_id WHERE ar.user_id=? AND r.status IN ('pending','partially_applied')").bind(userId).first<{ count: number }>(),
  ]);
  const recentFailures = [...runFailures.results, ...accessFailures.results].sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 20);
  return { today, month, byFeature: byFeature.results, byModel: byModel.results, recentFailures, pendingFeedbackDrafts: Number(pendingFeedback?.count || 0), pendingQuestionReviews: Number(pendingQuestions?.count || 0) };
}
