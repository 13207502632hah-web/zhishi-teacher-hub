export function normalize(value: unknown) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function bigrams(value: string) {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

export type QuestionTextProfile = {
  normalized: string;
  counts: Map<string, number>;
  denominator: number;
};

export function questionTextProfile(value: unknown): QuestionTextProfile {
  const normalized = normalize(value), counts = new Map<string, number>();
  for (const item of bigrams(normalized)) counts.set(item, (counts.get(item) || 0) + 1);
  return { normalized, counts, denominator: Math.max(1, normalized.length - 1) };
}

export function profiledQuestionTextSimilarity(left: QuestionTextProfile, right: QuestionTextProfile) {
  if (!left.normalized || !right.normalized) return 0;
  if (left.normalized === right.normalized) return 1;
  const [smaller, larger] = left.counts.size <= right.counts.size ? [left.counts, right.counts] : [right.counts, left.counts];
  let overlap = 0;
  for (const [gram, amount] of smaller) overlap += Math.min(amount, larger.get(gram) || 0);
  return Number((2 * overlap / (left.denominator + right.denominator)).toFixed(3));
}

/** 仅用于提示人工并排核对，不据此删除或合并题目。 */
export function questionTextSimilarity(left: unknown, right: unknown) {
  return profiledQuestionTextSimilarity(questionTextProfile(left), questionTextProfile(right));
}
