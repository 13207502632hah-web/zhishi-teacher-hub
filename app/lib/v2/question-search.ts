import { env } from "cloudflare:workers";
import type { AccessContext } from "../access";
import { callV2AiJson, cosineSimilarity, createV2Embedding, localSemanticVector, queryV2VectorIndex } from "./ai-router";
import { boundedNumber, isSearchMode, type QuestionSearchFilters, type QuestionSearchRequest, type SearchMode } from "./contracts";
import { ensureLocalQuestionVectors } from "./vector-index";

type QuestionRow = Record<string, unknown> & { id: number; stem: string };
type SearchHit = QuestionRow & {
  keywordScore: number;
  semanticScore: number;
  rerankScore: number;
  finalScore: number;
  matchReasons: string[];
};

const SEARCH_COLUMNS = "id,stem,material,question_type AS questionType,difficulty,stage,grade,textbook_version AS textbookVersion,volume,unit,topic,knowledge_points AS knowledgePoints,source,year,region,exam_type AS examType,is_favorite AS isFavorite,use_count AS useCount,status,parse_confidence AS parseConfidence,updated_at AS updatedAt";

const clean = (value: unknown, max = 100) => String(value || "").trim().slice(0, max);
const tokensOf = (query: string) => [...new Set(query.toLowerCase().split(/[\s，。；、：？！,.;:?!()（）【】\[\]]+/).map((value) => value.trim()).filter((value) => value.length > 1))].slice(0, 12);

function normalizeRequest(value: unknown): QuestionSearchRequest {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawFilters = body.filters && typeof body.filters === "object" ? body.filters as Record<string, unknown> : {};
  const filters: QuestionSearchFilters = {
    stage: clean(rawFilters.stage), grade: clean(rawFilters.grade), textbookVersion: clean(rawFilters.textbookVersion), volume: clean(rawFilters.volume),
    unit: clean(rawFilters.unit), topic: clean(rawFilters.topic), questionType: clean(rawFilters.questionType), region: clean(rawFilters.region), source: clean(rawFilters.source), status: clean(rawFilters.status) || "active",
  };
  if (Array.isArray(rawFilters.knowledge)) filters.knowledge = rawFilters.knowledge.map((item) => clean(item, 50)).filter(Boolean).slice(0, 10);
  const difficulty = Number(rawFilters.difficulty), year = Number(rawFilters.year);
  if (Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 5) filters.difficulty = difficulty;
  if (Number.isInteger(year) && year >= 1900 && year <= 2200) filters.year = year;
  return {
    query: clean(body.query, 500), mode: isSearchMode(body.mode) ? body.mode : "hybrid",
    phase: body.phase === "lexical" ? "lexical" : "semantic", filters,
    cursor: clean(body.cursor, 30), pageSize: boundedNumber(body.pageSize, 20, 1, 50),
    useCase: ["browse", "lesson", "paper", "remediation"].includes(String(body.useCase)) ? body.useCase as QuestionSearchRequest["useCase"] : "browse",
  };
}

function whereFor(filters: QuestionSearchFilters, query = "") {
  const clauses = ["1=1"], bindings: unknown[] = [];
  const equals: Array<[keyof QuestionSearchFilters, string]> = [
    ["stage", "stage"], ["grade", "grade"], ["textbookVersion", "textbook_version"], ["volume", "volume"], ["unit", "unit"], ["topic", "topic"],
    ["questionType", "question_type"], ["difficulty", "difficulty"], ["region", "region"], ["year", "year"], ["status", "status"],
  ];
  for (const [key, column] of equals) if (filters[key] !== undefined && filters[key] !== "") { clauses.push(`${column}=?`); bindings.push(filters[key]); }
  if (filters.source) { clauses.push("source LIKE ?"); bindings.push(`%${filters.source}%`); }
  for (const token of filters.knowledge || []) { clauses.push("(instr(COALESCE(knowledge_points,''),?)>0 OR instr(COALESCE(secondary_knowledge,''),?)>0)"); bindings.push(token, token); }
  if (query) {
    const pieces = [query, ...tokensOf(query)].slice(0, 10), matches: string[] = ["CAST(id AS TEXT)=?"]; bindings.push(query.replace(/^#/, ""));
    for (const piece of pieces) { matches.push("instr(lower(stem),lower(?))>0", "instr(lower(COALESCE(material,'')),lower(?))>0", "instr(lower(COALESCE(analysis,'')),lower(?))>0", "instr(lower(COALESCE(knowledge_points,'')),lower(?))>0", "instr(lower(COALESCE(tags,'')),lower(?))>0"); bindings.push(piece, piece, piece, piece, piece); }
    clauses.push(`(${matches.join(" OR ")})`);
  }
  return { sql: clauses.join(" AND "), bindings };
}

function keywordScore(row: QuestionRow, query: string, tokens: string[]) {
  if (!query) return 0;
  const haystack = `${row.stem || ""} ${row.material || ""} ${row.knowledgePoints || ""} ${row.topic || ""}`.toLowerCase();
  const normalized = query.toLowerCase(), idExact = normalized.replace(/^#/, "") === String(row.id);
  let score = idExact ? 1 : haystack.includes(normalized) ? .78 : 0;
  if (tokens.length) score += tokens.filter((token) => haystack.includes(token)).length / tokens.length * .2;
  return Math.min(1, score);
}

const searchableText = (row: QuestionRow) => [row.stem, row.material, row.questionType, row.stage, row.grade, row.topic, row.knowledgePoints, row.source, row.region, row.year].filter(Boolean).join("\n");

function reasonFor(row: QuestionRow, query: string, keyword: number, semantic: number) {
  const reasons: string[] = [];
  if (String(row.id) === query.replace(/^#/, "")) reasons.push("题号精确命中");
  if (keyword >= .75) reasons.push("题干或材料直接包含查询内容");
  else if (keyword > 0) reasons.push("关键词与知识点部分匹配");
  if (semantic >= .72) reasons.push("题意与查询目标高度相近");
  else if (semantic >= .45) reasons.push("题意存在语义关联");
  if (row.knowledgePoints) reasons.push(`知识点：${String(row.knowledgePoints).slice(0, 60)}`);
  if (row.topic) reasons.push(`章节：${String(row.topic).slice(0, 40)}`);
  return reasons.slice(0, 4);
}

async function parseIntent(access: AccessContext, request: QuestionSearchRequest) {
  if (!request.query || Object.entries(request.filters || {}).some(([key, value]) => key !== "status" && (Array.isArray(value) ? value.length : value))) return request;
  try {
    const result = await callV2AiJson({
      access, capability: "fast", promptVersion: "question-search-intent-v2.1",
      system: "你是中小学题库检索意图解析器。保留原查询；只有表达明确时才填写筛选条件。输出 {query,filters:{stage,grade,textbookVersion,volume,unit,topic,knowledge,questionType,difficulty,region,year,source}}。",
      payload: { query: request.query, useCase: request.useCase }, maxTokens: 1000,
      validate(value) {
        if (!value || typeof value !== "object") throw new Error("invalid intent");
        const item = value as Record<string, unknown>;
        return { query: clean(item.query, 500) || request.query, filters: item.filters && typeof item.filters === "object" ? item.filters as Record<string, unknown> : {} };
      },
    });
    const normalized = normalizeRequest({ ...request, query: result.data.query, filters: { ...request.filters, ...result.data.filters, status: request.filters?.status || "active" } });
    return { ...normalized, phase: request.phase, mode: request.mode, cursor: request.cursor, pageSize: request.pageSize, useCase: request.useCase };
  } catch { return request; }
}

async function optionalRerank(access: AccessContext, query: string, hits: SearchHit[]) {
  if (!query || hits.length < 2) return hits;
  try {
    const result = await callV2AiJson({
      access, capability: "rerank", promptVersion: "question-rerank-v2.1", maxTokens: 1600,
      system: "根据教师检索意图重排候选题。只能使用候选 id；输出 {ranking:[{id,score,reason}]}，score 为 0 到 1。",
      payload: { query, candidates: hits.slice(0, 20).map((hit) => ({ id: hit.id, stem: hit.stem.slice(0, 240), knowledgePoints: hit.knowledgePoints, difficulty: hit.difficulty })) },
      validate(value) {
        const ranking = (value as Record<string, unknown>)?.ranking;
        if (!Array.isArray(ranking)) throw new Error("invalid ranking");
        return ranking.map((item) => item as Record<string, unknown>).filter((item) => Number.isInteger(Number(item.id))).slice(0, 20);
      },
    });
    const scores = new Map(result.data.map((item) => [Number(item.id), boundedNumber(item.score, 0, 0, 1)]));
    return hits.map((hit) => ({ ...hit, rerankScore: scores.get(hit.id) || 0, finalScore: hit.finalScore * .72 + (scores.get(hit.id) || 0) * .28 })).sort((a, b) => b.finalScore - a.finalScore);
  } catch { return hits; }
}

export async function searchQuestionsV2(access: AccessContext, input: unknown) {
  const startedAt = Date.now(), initial = normalizeRequest(input), request = await parseIntent(access, initial);
  const pageSize = request.pageSize || 20, offset = boundedNumber(request.cursor, 0, 0, 100_000);
  const requestedMode: SearchMode = request.mode;
  const lexicalOnly = request.phase === "lexical" || requestedMode === "keyword";
  const base = whereFor(request.filters || {}), lexical = whereFor(request.filters || {}, request.query);
  const count = await env.DB.prepare(`SELECT count(*) AS total FROM questions WHERE ${base.sql}`).bind(...base.bindings).first<{ total: number }>(), tokens = tokensOf(request.query);
  const candidateLimit = lexicalOnly ? Math.min(250, offset + pageSize * 5) : 800;
  const lexicalRows = await env.DB.prepare(`SELECT ${SEARCH_COLUMNS} FROM questions WHERE ${lexical.sql} ORDER BY is_favorite DESC,use_count DESC,updated_at DESC LIMIT ?`).bind(...lexical.bindings, candidateLimit).all<QuestionRow>();
  if (request.query && tokens.length) {
    try {
      const ftsQuery = tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(" OR "), fts = await env.DB.prepare("SELECT rowid AS id,bm25(v2_questions_fts) AS rank FROM v2_questions_fts WHERE v2_questions_fts MATCH ? ORDER BY rank LIMIT 300").bind(ftsQuery).all<{ id: number }>();
      const existing = new Set(lexicalRows.results.map((row) => Number(row.id))), ids = fts.results.map((row) => Number(row.id)).filter((id) => !existing.has(id));
      if (ids.length) { const marks = ids.map(() => "?").join(","), rows = await env.DB.prepare(`SELECT ${SEARCH_COLUMNS} FROM questions WHERE id IN (${marks}) AND ${base.sql}`).bind(...ids, ...base.bindings).all<QuestionRow>(); lexicalRows.results.push(...rows.results); }
    } catch { /* 迁移尚未应用的候选环境继续使用结构化与 instr 检索。 */ }
  }
  let pool = lexicalRows.results;
  if (!lexicalOnly && pool.length < 200) {
    const fallback = await env.DB.prepare(`SELECT ${SEARCH_COLUMNS} FROM questions WHERE ${base.sql} ORDER BY is_favorite DESC,use_count DESC,updated_at DESC LIMIT ?`).bind(...base.bindings, 800).all<QuestionRow>();
    const merged = new Map<number, QuestionRow>();
    [...pool, ...fallback.results].forEach((row) => merged.set(Number(row.id), { ...row, id: Number(row.id), stem: String(row.stem || "") }));
    pool = [...merged.values()];
  }
  const requestedEmbedding = lexicalOnly || !request.query ? null : await createV2Embedding(request.query), external = requestedEmbedding && !requestedEmbedding.fallback ? await queryV2VectorIndex(requestedEmbedding.vector, 800, request.filters || {}) : { available: false, matches: [] as Array<{ id: number; score: number }> }, externalScores = new Map(external.matches.map((item) => [item.id, item.score]));
  if (externalScores.size) { const existing = new Set(pool.map((row) => Number(row.id))), ids = [...externalScores.keys()].filter((id) => !existing.has(id)); if (ids.length) { const marks = ids.map(() => "?").join(","), remoteRows = await env.DB.prepare(`SELECT ${SEARCH_COLUMNS} FROM questions WHERE id IN (${marks}) AND ${base.sql}`).bind(...ids, ...base.bindings).all<QuestionRow>(); pool.push(...remoteRows.results); } }
  const queryEmbedding = requestedEmbedding && external.available ? requestedEmbedding : requestedEmbedding ? { model: "local-char-ngram-v1", vector: localSemanticVector(request.query), fallback: true } : null;
  const storedVectors = queryEmbedding?.fallback ? await ensureLocalQuestionVectors(pool.map((row) => ({ id: Number(row.id), text: searchableText(row) }))) : new Map<number, number[]>();
  let hits: SearchHit[] = pool.map((row, index) => {
    const keyword = keywordScore(row, request.query, tokens);
    const semantic = externalScores.get(Number(row.id)) ?? (queryEmbedding ? cosineSimilarity(queryEmbedding.vector, storedVectors.get(Number(row.id)) || localSemanticVector(searchableText(row), queryEmbedding.vector.length)) : 0);
    const lexicalRank = lexicalRows.results.findIndex((candidate) => Number(candidate.id) === Number(row.id));
    const rrf = (lexicalRank >= 0 ? 1 / (60 + lexicalRank + 1) : 0) + (semantic ? 1 / (60 + index + 1) : 0);
    const quality = Math.min(1, (Number(row.useCount || 0) / 30) + (row.isFavorite ? .25 : 0) + (Number(row.parseConfidence || 0) * .2));
    const finalScore = lexicalOnly ? keyword * .9 + quality * .1 : requestedMode === "semantic" ? semantic * .9 + quality * .1 : keyword * .38 + semantic * .48 + rrf * 5 + quality * .08;
    return { ...row, keywordScore: keyword, semanticScore: semantic, rerankScore: 0, finalScore, matchReasons: reasonFor(row, request.query, keyword, semantic) };
  }).filter((hit) => !request.query || hit.keywordScore > 0 || (!lexicalOnly && hit.semanticScore > .05)).sort((a, b) => b.finalScore - a.finalScore);
  if (!lexicalOnly && request.query) hits = await optionalRerank(access, request.query, hits.slice(0, 50));
  const page = hits.slice(offset, offset + pageSize), total = request.query ? hits.length : Number(count?.total || 0);
  const coverage = { totalCandidates: Number(count?.total || 0), compared: pool.length, complete: pool.length >= Number(count?.total || 0), semanticFallback: Boolean(queryEmbedding?.fallback), vectorIndexAvailable: external.available, embeddingModel: queryEmbedding?.model || null, requestedEmbeddingModel: requestedEmbedding?.model || null };
  const latencyMs = Date.now() - startedAt;
  await env.DB.prepare("INSERT INTO v2_search_events(user_id,query,mode,filters_json,result_ids_json,coverage_json,latency_ms) VALUES(?,?,?,?,?,?,?)")
    .bind(access.id, request.query, requestedMode, JSON.stringify(request.filters || {}), JSON.stringify(page.map((item) => item.id)), JSON.stringify(coverage), latencyMs).run();
  return {
    query: request.query, parsedFilters: request.filters, mode: requestedMode, phase: lexicalOnly ? "lexical" : "semantic",
    results: page.map(({ finalScore, ...hit }) => ({ ...hit, finalScore: Number(finalScore.toFixed(4)), keywordScore: Number(hit.keywordScore.toFixed(4)), semanticScore: Number(hit.semanticScore.toFixed(4)), rerankScore: Number(hit.rerankScore.toFixed(4)) })),
    total, cursor: offset + page.length < hits.length ? String(offset + page.length) : null, coverage, latencyMs,
  };
}
