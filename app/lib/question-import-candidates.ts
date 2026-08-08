import { bigrams, normalize, questionTextSimilarity } from "./question-similarity";

export type PreparedQuestion = Record<string, unknown> & {
  stem: string;
  fingerprint: string;
  questionType?: string;
  stage?: string;
  grade?: string;
};

export type SourceQuestionRef<
  Raw extends Record<string, unknown> = Record<string, unknown>,
  P extends PreparedQuestion = PreparedQuestion,
> = {
  sourceIndex: number;
  sourceQuestionNumber: number | null;
  raw: Raw;
  prepared: P;
  fingerprint: string;
};

export type SimilarityCandidate = { id: number; stem: string; fingerprint: string };
export type SimilarityCoverage = { total: number; compared: number; complete: boolean };
export type ExactDuplicateRow = { sourceIndex: number; fingerprint: string; stem: string; number: number };
export type SimilarityRow = {
  sourceIndex: number;
  sourceQuestionNumber: number | null;
  sourceStem: string;
  candidateId: number;
  candidateStem: string;
  similarity: number;
  exact: boolean;
};

export const QUESTION_SIMILARITY_BUDGET = 2000;
export const QUESTION_SIMILARITY_THRESHOLD = 0.82;
export const QUESTION_SIMILARITY_TOP = 3;
const STEM_TOKEN_BUDGET = 12;
const TEXT_SIGNATURE_LENGTH = 8;
const TEXT_PATTERN_CHUNK = 50;
const TEXT_PATTERN_ROW_LIMIT = 25;
const TEXT_CANDIDATE_BUDGET = 400;

type D1Like = {
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => {
      all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
      first: <T = Record<string, unknown>>() => Promise<T | null>;
    };
  };
};

/**
 * 原始导入题在解析阶段即获得不可变的 sourceIndex / sourceQuestionNumber；
 * 后续去重、过滤、相似检测与报告只能引用这两个字段，禁止用过滤后的数组下标反推。
 */
export function buildSourceQuestionRefs<
  Raw extends Record<string, unknown>,
  P extends PreparedQuestion,
>(
  input: Raw[],
  prepare: (raw: Raw, sourceIndex: number) => P,
): SourceQuestionRef<Raw, P>[] {
  return input.map((raw, sourceIndex) => {
    const prepared = prepare(raw, sourceIndex);
    const rawNumber = Number(raw.sourceQuestionNumber);
    return {
      sourceIndex,
      sourceQuestionNumber: Number.isFinite(rawNumber) && rawNumber > 0 ? rawNumber : null,
      raw,
      prepared,
      fingerprint: String(prepared.fingerprint || ""),
    };
  });
}

export function uniqueSourceRefs<
  Raw extends Record<string, unknown> = Record<string, unknown>,
  P extends PreparedQuestion = PreparedQuestion,
>(refs: SourceQuestionRef<Raw, P>[]): SourceQuestionRef<Raw, P>[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.fingerprint)) return false;
    seen.add(ref.fingerprint);
    return true;
  });
}

export function exactDuplicateRows<
  Raw extends Record<string, unknown> = Record<string, unknown>,
  P extends PreparedQuestion = PreparedQuestion,
>(refs: SourceQuestionRef<Raw, P>[], existingFingerprints: ReadonlySet<string>): ExactDuplicateRow[] {
  const firstOccurrence = new Map<string, number>();
  for (const ref of refs) {
    if (!firstOccurrence.has(ref.fingerprint)) firstOccurrence.set(ref.fingerprint, ref.sourceIndex);
  }
  return refs.flatMap((ref) => {
    if (existingFingerprints.has(ref.fingerprint) || firstOccurrence.get(ref.fingerprint) !== ref.sourceIndex) {
      return [{
        sourceIndex: ref.sourceIndex,
        fingerprint: ref.fingerprint,
        stem: ref.prepared.stem.slice(0, 120),
        number: ref.sourceQuestionNumber ?? ref.sourceIndex + 1,
      }];
    }
    return [];
  });
}

const placeholders = (length: number) => Array.from({ length }, () => "?").join(",");

const uniqueValues = (values: Array<string | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value)))];

function representativeStemTokens(refs: SourceQuestionRef[]): string[] {
  const stems = refs.map((ref) => normalize(ref.prepared.stem)).filter(Boolean);
  if (!stems.length) return [];
  const tokenRefs = new Map<string, Set<number>>();
  stems.forEach((stem, index) => {
    for (const token of bigrams(stem)) {
      if (/[A-Za-z0-9]/.test(token)) continue;
      const indexes = tokenRefs.get(token) || new Set<number>();
      indexes.add(index);
      tokenRefs.set(token, indexes);
    }
  });
  const remaining = new Set(stems.map((_, index) => index));
  const selected: string[] = [];
  while (remaining.size && selected.length < STEM_TOKEN_BUDGET) {
    let best = "";
    let bestCount = 0;
    for (const [token, indexes] of tokenRefs) {
      if (selected.includes(token)) continue;
      let count = 0;
      for (const index of indexes) if (remaining.has(index)) count += 1;
      if (count > bestCount || (count === bestCount && count > 0 && token < best)) {
        best = token;
        bestCount = count;
      }
    }
    if (!bestCount) break;
    selected.push(best);
    for (const index of tokenRefs.get(best) || []) remaining.delete(index);
  }
  return selected;
}

const chunkValues = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

/**
 * 把题干前 8 个规范化字符展开为容忍空格/标点穿插的 LIKE 模式，
 * 让文本源能直接命中规范化后相同、原始字符串不同的旧题行。
 */
function stemTextPatterns(refs: SourceQuestionRef[]): string[] {
  const patterns = new Set<string>();
  for (const ref of refs) {
    const signature = normalize(ref.prepared.stem)
      .replace(/[%_\\]/g, "")
      .slice(0, TEXT_SIGNATURE_LENGTH);
    if (!signature || /^\d+$/.test(signature)) continue;
    patterns.add(signature.split("").join("%"));
  }
  return [...patterns];
}

const sqlStringLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * 两阶段候选检索：先按 fingerprint / question_type / stage / grade 用一条廉价 SQL
 * 获取有界候选池，昂贵的文本相似度只在该候选池内执行；题库过大时再按题干文本
 * 签名补充旧行，避免 `ORDER BY id DESC LIMIT` 只覆盖库尾。coverage 明确报告本次
 * 实际比对范围，避免把部分比对误报成全库检测。
 */
export async function collectSimilarityCandidates(
  db: D1Like,
  refs: SourceQuestionRef[],
  budget = QUESTION_SIMILARITY_BUDGET,
): Promise<{ candidates: SimilarityCandidate[]; coverage: SimilarityCoverage }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const pushCondition = (column: string, values: string[]) => {
    if (!values.length) return;
    conditions.push(`${column} IN (${placeholders(values.length)})`);
    params.push(...values);
  };
  pushCondition("fingerprint", uniqueValues(refs.map((ref) => ref.fingerprint)));
  pushCondition("question_type", uniqueValues(refs.map((ref) => String(ref.prepared.questionType || ""))));
  pushCondition("stage", uniqueValues(refs.map((ref) => String(ref.prepared.stage || ""))));
  pushCondition("grade", uniqueValues(refs.map((ref) => String(ref.prepared.grade || ""))));
  const stemTokens = representativeStemTokens(refs);
  if (stemTokens.length) {
    conditions.push(`(${stemTokens.map(() => "stem LIKE ?").join(" OR ")})`);
    params.push(...stemTokens.map((token) => `%${token}%`));
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" OR ")}` : "";

  const textPatterns = stemTextPatterns(refs);
  const textSubquery = `SELECT id, stem, fingerprint FROM (SELECT id, stem, fingerprint FROM questions WHERE stem LIKE ? ORDER BY id DESC LIMIT ${TEXT_PATTERN_ROW_LIMIT})`;
  const textChunkSql = (patterns: string[]) => patterns.map(() => textSubquery).join(" UNION ALL ");
  const textChunkResults = await Promise.all(
    chunkValues(textPatterns, TEXT_PATTERN_CHUNK).map((patterns) =>
      db.prepare(textChunkSql(patterns)).bind(...patterns.map((pattern) => `%${pattern}%`)).all<{ id: number; stem: string; fingerprint: string | null }>(),
    ),
  );
  const textCandidatesById = new Map<number, SimilarityCandidate>();
  for (const chunkResult of textChunkResults) {
    for (const row of chunkResult.results || []) {
      const id = Number(row.id);
      if (textCandidatesById.has(id)) continue;
      textCandidatesById.set(id, {
        id,
        stem: String(row.stem || ""),
        fingerprint: String(row.fingerprint || ""),
      });
    }
  }
  const textCandidates = [...textCandidatesById.values()]
    .sort((left, right) => right.id - left.id)
    .slice(0, Math.min(TEXT_CANDIDATE_BUDGET, budget));

  const unionConditions = [...conditions];
  if (textPatterns.length) {
    unionConditions.push(`(${textPatterns.map((pattern) => `stem LIKE ${sqlStringLiteral(`%${pattern}%`)}`).join(" OR ")})`);
  }
  const unionWhere = unionConditions.length ? ` WHERE ${unionConditions.join(" OR ")}` : "";
  const remaining = Math.max(0, budget - textCandidates.length);
  const [totalRow, poolResult] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT id) AS count FROM questions${unionWhere}`).bind(...params).first<{ count: number }>(),
    remaining > 0
      ? db.prepare(`SELECT id, stem, fingerprint FROM questions${where} ORDER BY id DESC LIMIT ?`).bind(...params, remaining).all<{ id: number; stem: string; fingerprint: string | null }>()
      : Promise.resolve({ results: [] as Array<{ id: number; stem: string; fingerprint: string | null }> }),
  ]);
  const total = Number(totalRow?.count || 0);
  const candidatesById = new Map<number, SimilarityCandidate>();
  for (const candidate of textCandidates) candidatesById.set(candidate.id, candidate);
  for (const row of poolResult.results || []) {
    const id = Number(row.id);
    if (candidatesById.has(id)) continue;
    candidatesById.set(id, {
      id,
      stem: String(row.stem || ""),
      fingerprint: String(row.fingerprint || ""),
    });
  }
  const candidates = [...candidatesById.values()].sort((left, right) => right.id - left.id);
  return {
    candidates,
    coverage: { total, compared: candidates.length, complete: candidates.length >= total },
  };
}

export function scanSimilarityCandidates(
  refs: SourceQuestionRef[],
  candidates: SimilarityCandidate[],
  options: { threshold?: number; top?: number; compare?: (left: string, right: string) => number } = {},
): SimilarityRow[] {
  const threshold = options.threshold ?? QUESTION_SIMILARITY_THRESHOLD;
  const top = options.top ?? QUESTION_SIMILARITY_TOP;
  const compare = options.compare || questionTextSimilarity;
  return refs.flatMap((ref) => candidates
    .filter((candidate) => candidate.fingerprint !== ref.fingerprint)
    .map((candidate) => ({
      sourceIndex: ref.sourceIndex,
      sourceQuestionNumber: ref.sourceQuestionNumber,
      sourceStem: ref.prepared.stem.slice(0, 180),
      candidateId: candidate.id,
      candidateStem: candidate.stem.slice(0, 180),
      similarity: compare(ref.prepared.stem, candidate.stem),
      exact: false,
    }))
    .filter((item) => item.similarity >= threshold)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, top));
}
