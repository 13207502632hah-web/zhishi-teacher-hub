function normalize(value: unknown) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function bigrams(value: string) {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => value.slice(index, index + 2));
}

/** 仅用于提示人工并排核对，不据此删除或合并题目。 */
export function questionTextSimilarity(left: unknown, right: unknown) {
  const a = normalize(left), b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const counts = new Map<string, number>();
  for (const item of bigrams(a)) counts.set(item, (counts.get(item) || 0) + 1);
  let overlap = 0;
  for (const item of bigrams(b)) { const count = counts.get(item) || 0; if (count > 0) { overlap += 1; counts.set(item, count - 1); } }
  return Number((2 * overlap / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1))).toFixed(3));
}
