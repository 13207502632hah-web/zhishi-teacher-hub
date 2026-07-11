export function normalizeQuestionText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();
}

/** 轻量稳定指纹，用于提示重复题；不替代教师的最终判断。 */
export function questionFingerprint(input: Record<string, unknown>) {
  const source = `${normalizeQuestionText(input.material)}\n${normalizeQuestionText(input.stem)}\n${normalizeQuestionText(input.options)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `q${(hash >>> 0).toString(36)}-${source.length}`;
}
