import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { fingerprint, redactPrivateText } from "./server";

const feedbackFields = ["learningContent", "highlights", "consolidate", "homeworkRequirements", "nextFocus", "parentAdvice", "reflectionOutline"] as const;

function feedbackDocument(value: Record<string, any> | string | null | undefined) {
  if (!value) return null;
  let row: Record<string, any>;
  if (typeof value === "string") {
    try { row = JSON.parse(value); } catch { row = { parentAdvice: value }; }
  } else row = value;
  const document = Object.fromEntries(feedbackFields.map((key) => [key, String(row[key] ?? (key === "parentAdvice" ? row.content : "") ?? "").trim()]));
  return Object.values(document).some(Boolean) ? document : null;
}

export async function recordFeedbackLearningEvent(access: AccessContext, row: Record<string, any>, beforeValue?: Record<string, any> | string | null) {
  if (access.role !== "teacher") return;
  const context = row.lessonId ? await env.DB.prepare("SELECT stage,grade FROM lessons WHERE id=?").bind(row.lessonId).first<Record<string, string>>() : null;
  const students = await env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>();
  const names = students.results.map((item) => String(item.name)), afterDocument = feedbackDocument(row), beforeDocument = feedbackDocument(beforeValue);
  if (!afterDocument || !beforeDocument) return;
  const afterTemplate = redactPrivateText(JSON.stringify(afterDocument), names), beforeTemplate = redactPrivateText(JSON.stringify(beforeDocument), names);
  if (afterTemplate === beforeTemplate) return;
  const contentFingerprint = await fingerprint(afterTemplate);
  await env.DB.prepare("INSERT OR IGNORE INTO ai_feedback_learning_events(user_id,feedback_id,audience,tone,stage,grade,content_template,edit_summary_json,content_fingerprint) VALUES(?,?,?,?,?,?,?,?,?)").bind(access.id, row.id, row.audience || null, row.tone || null, context?.stage || null, context?.grade || null, afterTemplate.slice(0, 6000), JSON.stringify({ before: beforeTemplate.slice(0, 6000), after: afterTemplate.slice(0, 6000), changedFields: feedbackFields.filter((key) => beforeDocument[key] !== afterDocument[key]) }), contentFingerprint).run();
}

export async function getLearningExamples(access: AccessContext, audience: string, tone: string, stage: string, grade: string) {
  const [rows, students] = await Promise.all([env.DB.prepare("SELECT content_template AS contentTemplate FROM ai_feedback_learning_events WHERE user_id=? AND active=1 AND (stage=? OR stage IS NULL) AND (grade=? OR grade IS NULL) AND (audience=? OR audience IS NULL) AND (tone=? OR tone IS NULL) ORDER BY CASE WHEN stage=? THEN 0 ELSE 1 END,CASE WHEN grade=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 12").bind(access.id, stage, grade, audience, tone, stage, grade).all<{ contentTemplate: string }>(), env.DB.prepare("SELECT name FROM students WHERE TRIM(COALESCE(name,''))<>''").all<{ name: string }>()]);
  const names = students.results.map((item) => String(item.name));
  return rows.results.map((item) => redactPrivateText(String(item.contentTemplate).slice(0, 1600), names));
}
