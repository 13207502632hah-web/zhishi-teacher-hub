export type AssessmentScore = { score: number | null; objectiveScore?: number | null; subjectiveScore?: number | null; weakKnowledge?: string | null };

export function validateAssessmentResult(result: AssessmentScore, totalScore: number) {
  if (!Number.isFinite(totalScore) || totalScore <= 0) return "测验总分必须大于 0";
  for (const [label, value] of [["总分", result.score], ["客观题", result.objectiveScore], ["主观题", result.subjectiveScore]] as const) {
    if (value == null) continue;
    if (!Number.isFinite(value) || value < 0 || value > totalScore) return `${label}必须在 0 到 ${totalScore} 之间`;
  }
  if (result.score != null && result.objectiveScore != null && result.subjectiveScore != null && Math.abs(result.objectiveScore + result.subjectiveScore - result.score) > 0.01) return "客观题与主观题得分之和应等于总分";
  return null;
}

export function assessmentStats(results: AssessmentScore[], totalScore: number) {
  const scores = results.map((item) => item.score).filter((item): item is number => item != null && Number.isFinite(item));
  if (!scores.length) return { count: 0, average: null, highest: null, lowest: null, rate: null, bands: {} as Record<string, number>, weakKnowledge: [] as Array<{ name: string; count: number }> };
  const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length * 10) / 10;
  const bands = { "优秀（≥85%）": 0, "良好（70%–84%）": 0, "基础（60%–69%）": 0, "待巩固（<60%）": 0 };
  for (const score of scores) { const rate = score / totalScore; if (rate >= .85) bands["优秀（≥85%）"] += 1; else if (rate >= .7) bands["良好（70%–84%）"] += 1; else if (rate >= .6) bands["基础（60%–69%）"] += 1; else bands["待巩固（<60%）"] += 1; }
  const weak = new Map<string, number>();
  for (const result of results) for (const item of String(result.weakKnowledge || "").split(/[,，、;；\n]/).map((value) => value.trim()).filter(Boolean)) weak.set(item, (weak.get(item) || 0) + 1);
  return { count: scores.length, average, highest: Math.max(...scores), lowest: Math.min(...scores), rate: Math.round(average / totalScore * 1000) / 10, bands, weakKnowledge: [...weak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })) };
}
