export const REVIEW_CONFIDENCE = 0.85;
export type RecognitionDraft = { confidence?: number | null; teacherScore?: number | null; maxScore?: number | null; studentAnswer?: string | null; reviewStatus?: string };
export function canConfirmRecognition(item: RecognitionDraft) {
  return item.reviewStatus === "confirmed" || (Number(item.confidence || 0) >= REVIEW_CONFIDENCE && item.teacherScore != null && Number(item.teacherScore) >= 0 && (item.maxScore == null || Number(item.teacherScore) <= Number(item.maxScore)));
}
export function masteryLevel(correctRate: number | null, evidenceCount: number) {
  if (!evidenceCount) return "未接触";
  if (evidenceCount < 2 || Number(correctRate || 0) < 0.5) return "初步了解";
  if (Number(correctRate || 0) < 0.8) return "基本掌握";
  return "熟练运用";
}
