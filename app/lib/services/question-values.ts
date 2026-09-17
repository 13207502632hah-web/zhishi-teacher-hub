import { questionFingerprint } from "../question-fingerprint";
import { TEACHER_DISPLAY_NAME } from "../brand";

/** Import admission is automatic; it never attests that a teacher checked the answer. */
export const autoImportedQuestionValues = (payload: Record<string, unknown>) => questionValues({
  ...payload, status: "active", reviewed: false, reviewStatus: "auto_checked",
});

const backfillTextFields = ["answer", "answerPoints", "analysis", "scoringPoints", "knowledgePoints", "secondaryKnowledge", "coreCompetencies", "factBasis", "textbookView", "valueJudgment", "answerLogic", "standardExpression"] as const;
const hasContent = (value: unknown) => !["", "[]", "{}", "null"].includes(String(value ?? "").trim());

/** Exact duplicate answer editions may fill blanks, but never overwrite existing teaching content. */
export function importedQuestionBackfill(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}, fields: string[] = [];
  for (const field of backfillTextFields) {
    if (!hasContent(existing[field]) && hasContent(incoming[field])) { patch[field] = incoming[field]; fields.push(field); }
  }
  if (!(Number(existing.score) > 0) && Number(incoming.score) > 0) { patch.score = Number(incoming.score); fields.push("score"); }
  if (!fields.length) return { patch, fields };
  const merged = { ...existing, ...patch };
  const obsolete = new Set([
    hasContent(merged.answer) ? "【存疑】缺少答案" : "",
    hasContent(merged.analysis) ? "【存疑】缺少解析" : "",
    hasContent(merged.knowledgePoints) ? "【存疑】缺少知识点" : "",
  ].filter(Boolean));
  patch.notes = String(existing.notes || "").split("\n").filter((line) => !obsolete.has(line.trim())).join("\n");
  patch.parseConfidence = Math.max(Number(existing.parseConfidence || 0), Number(incoming.parseConfidence || 0));
  if (!existing.reviewed) patch.reviewStatus = "auto_checked";
  return { patch, fields };
}

const jsonField = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value || []);

const importNotesField = (payload: Record<string, unknown>) => {
  const existing = String(payload.notes || "").trim();
  const sourceQuestionNumber = Number(payload.sourceQuestionNumber);
  const importNotes = Array.isArray(payload.importNotes) ? payload.importNotes.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return [
    existing,
    Number.isFinite(sourceQuestionNumber) && sourceQuestionNumber > 0 ? `原题号：${sourceQuestionNumber}` : "",
    ...importNotes,
  ].filter(Boolean).join("\n");
};

export const questionValues = (payload: Record<string, unknown>) => ({
  questionGroup: String(payload.questionGroup || ""), subQuestions: jsonField(payload.subQuestions), scoringPoints: jsonField(payload.scoringPoints), attachments: jsonField(payload.attachments), tables: jsonField(payload.tables), parseConfidence: Math.max(0, Math.min(1, Number(payload.parseConfidence ?? 1))), reviewStatus: String(payload.reviewStatus || (payload.reviewed ? "confirmed" : "pending")), sourceDocumentId: payload.sourceDocumentId ? Number(payload.sourceDocumentId) : null,
stem: String(payload.stem || "").trim(), material: String(payload.material || ""), options: String(payload.options || ""), answer: String(payload.answer || ""), answerPoints: String(payload.answerPoints || ""), analysis: String(payload.analysis || ""), factBasis: String(payload.factBasis || ""), textbookView: String(payload.textbookView || ""), valueJudgment: String(payload.valueJudgment || ""), answerLogic: String(payload.answerLogic || ""), standardExpression: String(payload.standardExpression || ""), questionType: String(payload.questionType || "单选题"), difficulty: Number(payload.difficulty || 3), score: Number(payload.score || 0), stage: String(payload.stage || "高中"), grade: String(payload.grade || "高一"), textbookVersion: String(payload.textbookVersion || "统编版"), volume: String(payload.volume || ""), unit: String(payload.unit || ""), topic: String(payload.topic || ""), knowledgePoints: String(payload.knowledgePoints || ""), secondaryKnowledge: String(payload.secondaryKnowledge || ""), coreCompetencies: String(payload.coreCompetencies || ""), abilityLevel: String(payload.abilityLevel || ""), source: String(payload.source || ""), sourceFile: String(payload.sourceFile || ""), year: payload.year ? Number(payload.year) : null, region: String(payload.region || ""), examType: String(payload.examType || ""), scenario: String(payload.scenario || ""), fingerprint: questionFingerprint(payload), reviewed: Boolean(payload.reviewed), isOriginal: Boolean(payload.isOriginal), isFavorite: Boolean(payload.isFavorite), isWrong: Boolean(payload.isWrong), isFrequent: Boolean(payload.isFrequent), tags: String(payload.tags || ""), recordedBy: String(payload.recordedBy || TEACHER_DISPLAY_NAME), status: String(payload.status || "active"), notes: importNotesField(payload)
});
