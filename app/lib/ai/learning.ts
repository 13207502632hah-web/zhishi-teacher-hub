import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { fingerprint, redactPrivateText } from "./server";

export async function recordFeedbackLearningEvent(access: AccessContext, row: Record<string, any>, beforeContent = "") {
  if (access.role !== "teacher" || !String(row.content || "").trim()) return;
  const context = row.lessonId ? await env.DB.prepare("SELECT stage,grade FROM lessons WHERE id=?").bind(row.lessonId).first<Record<string, string>>() : null;
  const student = row.studentId ? await env.DB.prepare("SELECT name FROM students WHERE id=?").bind(row.studentId).first<{ name: string }>() : null;
  const contentTemplate = redactPrivateText(row.content, student?.name ? [student.name] : []), contentFingerprint = await fingerprint({ contentTemplate, audience: row.audience, tone: row.tone });
  await env.DB.prepare("INSERT OR IGNORE INTO ai_feedback_learning_events(user_id,feedback_id,audience,tone,stage,grade,content_template,edit_summary_json,content_fingerprint) VALUES(?,?,?,?,?,?,?,?,?)").bind(access.id, row.id, row.audience || null, row.tone || null, context?.stage || null, context?.grade || null, contentTemplate.slice(0, 6000), JSON.stringify({ previousLength: beforeContent.length, savedLength: String(row.content).length }), contentFingerprint).run();
}

export async function getLearningExamples(access: AccessContext, audience: string, tone: string) {
  const rows = await env.DB.prepare("SELECT content_template AS contentTemplate FROM ai_feedback_learning_events WHERE user_id=? AND active=1 AND (audience=? OR audience IS NULL) AND (tone=? OR tone IS NULL) ORDER BY updated_at DESC LIMIT 8").bind(access.id, audience, tone).all<{ contentTemplate: string }>();
  return rows.results.map((item) => String(item.contentTemplate).slice(0, 1600));
}
