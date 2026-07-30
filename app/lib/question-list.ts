export function mergeQuestionSelection(current: number[], additions: number[]) {
  return [...new Set([...current, ...additions].filter((id) => Number.isInteger(id) && id > 0))];
}
