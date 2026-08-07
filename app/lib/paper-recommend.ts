export type RecommendCandidate = {
  id: number;
  stem: string;
  score?: number;
  questionType?: string;
  difficulty?: number;
  useCount?: number;
  knowledgePoints?: string;
  secondaryKnowledge?: string;
};

export type RecommendOptions<T extends RecommendCandidate> = {
  candidates: T[];
  count: number;
  targetScore: number;
  excludeRecent?: boolean;
};

export type RecommendReport<T extends RecommendCandidate = RecommendCandidate> = {
  picked: T[];
  totalScore: number;
  countGap: number;
  scoreGap: number;
  reachedTarget: boolean;
  reasons: string[];
  distributions: {
    types: Record<string, { count: number; score: number }>;
    difficulties: Record<string, { count: number; score: number }>;
    knowledge: { covered: string[] };
  };
};

const splitKnowledge = (item: RecommendCandidate) =>
  [item.knowledgePoints, item.secondaryKnowledge]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" / ")
    .split(/[、,，/]/)
    .map((part) => part.trim())
    .filter(Boolean);

const emptyDistributions = () => ({
  types: {} as Record<string, { count: number; score: number }>,
  difficulties: {} as Record<string, { count: number; score: number }>,
  knowledge: { covered: [] as string[] },
});

export function recommendPaperQuestions<T extends RecommendCandidate>({ candidates, count, targetScore, excludeRecent }: RecommendOptions<T>): RecommendReport<T> {
  const maxCount = Math.max(1, Math.min(100, Math.floor(Number(count) || 10)));
  const goal = Math.max(0, Number(targetScore) || 0);
  const usable = (candidates || []).filter(
    (item) =>
      item &&
      Number(item.id) > 0 &&
      typeof item.stem === "string" &&
      item.stem.trim().length > 0 &&
      Number(item.score || 0) > 0,
  );
  const picked: T[] = [];
  const types: Record<string, { count: number; score: number }> = {};
  const difficulties: Record<string, { count: number; score: number }> = {};
  const covered = new Set<string>();
  const reasons: string[] = [];
  let totalScore = 0;

  if (!usable.length) {
    return {
      picked,
      totalScore: 0,
      countGap: maxCount,
      scoreGap: goal,
      reachedTarget: false,
      reasons: ["没有可用的候选题：请放宽筛选条件，或先在正式题库中补充有分值的题目"],
      distributions: emptyDistributions(),
    };
  }

  const remaining = [...usable];
  while (remaining.length > 0 && picked.length < maxCount && totalScore < goal) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index];
      const score = Number(item.score || 0);
      const tokens = splitKnowledge(item);
      const newCoverage = tokens.filter((token) => !covered.has(token)).length;
      const typeName = item.questionType || "未分类";
      const difficultyName = String(item.difficulty || "—");
      const typePenalty = (types[typeName]?.count || 0) * 3;
      const difficultyPenalty = (difficulties[difficultyName]?.count || 0) * 2;
      const usePenalty = (excludeRecent ? 8 : 1) * Number(item.useCount || 0);
      const remainingScore = goal - totalScore;
      const overshootPenalty = remainingScore > 0 && score > remainingScore ? (score - remainingScore) * 0.25 : 0;
      const fitPenalty = Math.abs(remainingScore - score) * 0.05;
      const candidateScore = newCoverage * 5 + 1 - typePenalty - difficultyPenalty - usePenalty - overshootPenalty - fitPenalty;
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    const [item] = remaining.splice(bestIndex, 1);
    picked.push(item);
    const score = Number(item.score || 0);
    totalScore += score;
    const typeName = item.questionType || "未分类";
    const difficultyName = String(item.difficulty || "—");
    types[typeName] = { count: (types[typeName]?.count || 0) + 1, score: (types[typeName]?.score || 0) + score };
    difficulties[difficultyName] = { count: (difficulties[difficultyName]?.count || 0) + 1, score: (difficulties[difficultyName]?.score || 0) + score };
    for (const token of splitKnowledge(item)) covered.add(token);
  }

  const countGap = Math.max(0, maxCount - picked.length);
  const scoreGap = Math.max(0, goal - totalScore);
  const reachedTarget = totalScore >= goal && picked.length > 0;

  if (reachedTarget) {
    reasons.push(`已达到目标总分 ${totalScore} 分；在 ${maxCount} 题上限内共选择 ${picked.length} 题`);
  } else {
    reasons.push(`当前组合共 ${totalScore} 分，距离目标还差 ${scoreGap} 分`);
    reasons.push(countGap > 0 ? `题量上限 ${maxCount} 题内还可补充 ${countGap} 题` : "已用满题量上限仍无法达到目标总分，请放宽筛选条件");
  }
  const coveredList = [...covered];
  if (coveredList.length) reasons.push(`知识点覆盖：${coveredList.slice(0, 6).join("、")}${coveredList.length > 6 ? " 等" : ""}`);
  const typeText = Object.entries(types)
    .map(([type, info]) => `${type} ${info.count} 题 / ${info.score} 分`)
    .join("，");
  if (typeText) reasons.push(`题型分布：${typeText}`);
  if (excludeRecent) reasons.push("优先避开了近期已用题目");

  return {
    picked,
    totalScore,
    countGap,
    scoreGap,
    reachedTarget,
    reasons,
    distributions: { types, difficulties, knowledge: { covered: coveredList } },
  };
}
