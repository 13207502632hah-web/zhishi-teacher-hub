import { questionTextSimilarity } from "./question-similarity";

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

export const QUESTION_SIMILARITY_BUDGET = 1200;
export const QUESTION_SIMILARITY_THRESHOLD = 0.82;
export const QUESTION_SIMILARITY_TOP = 3;

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

/**
 * 两阶段候选检索：先按 fingerprint / question_type / stage / grade 用一条廉价 SQL
 * 获取有界候选池，昂贵的文本相似度只在该候选池内执行。coverage 明确报告本次
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
  const where = conditions.length ? ` WHERE ${conditions.join(" OR ")}` : "";
  const [poolResult, totalRow] = await Promise.all([
    db.prepare(`SELECT id, stem, fingerprint FROM questions${where} ORDER BY id DESC LIMIT ?`).bind(...params, budget).all<{ id: number; stem: string; fingerprint: string | null }>(),
    db.prepare("SELECT COUNT(*) AS count FROM questions").bind().first<{ count: number }>(),
  ]);
  const total = Number(totalRow?.count || 0);
  const candidates = (poolResult.results || []).map((row) => ({
    id: Number(row.id),
    stem: String(row.stem || ""),
    fingerprint: String(row.fingerprint || ""),
  }));
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
