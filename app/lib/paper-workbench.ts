type PaperQuestion = Record<string, unknown> & { id?: unknown; score?: unknown; groupTitle?: unknown; answerSpace?: unknown };

export function restorePaperSelection<T extends PaperQuestion>(saved: PaperQuestion[], active: T[]) {
  const savedById = new Map(saved.map((item) => [Number(item.id), item]));
  return active.flatMap<T & { score: number; groupTitle: string; answerSpace: number }>((item) => {
    const prior = savedById.get(Number(item.id));
    if (!prior) return [];
    return [{
      ...item,
      score: Number.isFinite(Number(prior.score)) ? Number(prior.score) : Number(item.score || 0),
      groupTitle: String(prior.groupTitle || ""),
      answerSpace: Math.max(1, Math.min(12, Number(prior.answerSpace || 2))),
    }];
  });
}

export function paperDraftIssues(input: { title: string; durationMinutes: string; questions: PaperQuestion[] }) {
  const issues: string[] = [];
  if (!input.title.trim()) issues.push("请填写试卷名称");
  if (!input.questions.length) issues.push("请至少选择一道题目");
  input.questions.forEach((question, index) => {
    const score = Number(question.score);
    if (!Number.isFinite(score)) issues.push(`第 ${index + 1} 题分值必须是数字`);
    else if (score < 0) issues.push(`第 ${index + 1} 题分值不能小于 0`);
  });
  if (input.durationMinutes) {
    const duration = Number(input.durationMinutes);
    if (!Number.isInteger(duration) || duration <= 0) issues.push("限时必须是大于 0 的整数");
  }
  return issues;
}
