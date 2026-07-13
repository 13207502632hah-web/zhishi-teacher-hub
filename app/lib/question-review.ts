export const QUESTION_REVIEW_STATUS = "review";

export async function questionReviewSummary(db: D1Database) {
  const row = await db.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(answer,'')='' THEN 1 ELSE 0 END) AS missingAnswer,
    SUM(CASE WHEN COALESCE(analysis,'')='' THEN 1 ELSE 0 END) AS missingAnalysis,
    SUM(CASE WHEN COALESCE(stage,'')='' OR COALESCE(grade,'')='' OR COALESCE(knowledge_points,'')='' THEN 1 ELSE 0 END) AS missingClassification,
    SUM(CASE WHEN COALESCE(parse_confidence,1)<0.7 THEN 1 ELSE 0 END) AS lowConfidence
    FROM questions WHERE status=?`).bind(QUESTION_REVIEW_STATUS).first<Record<string, unknown>>();
  return {
    total: Number(row?.total || 0),
    missingAnswer: Number(row?.missingAnswer || 0),
    missingAnalysis: Number(row?.missingAnalysis || 0),
    missingClassification: Number(row?.missingClassification || 0),
    lowConfidence: Number(row?.lowConfidence || 0),
  };
}
