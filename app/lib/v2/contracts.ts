export const jobStates = ["queued", "running", "waiting_review", "completed", "partial", "failed", "cancelled"] as const;
export const approvalStates = ["pending", "approved", "rejected", "expired"] as const;
export const importRowStates = ["valid", "warning", "blocked", "processing", "created", "updated", "skipped", "failed"] as const;
export const searchModes = ["keyword", "semantic", "hybrid"] as const;

export type JobState = (typeof jobStates)[number];
export type ApprovalState = (typeof approvalStates)[number];
export type ImportRowState = (typeof importRowStates)[number];
export type SearchMode = (typeof searchModes)[number];
export type JsonObject = Record<string, unknown>;

export type V2Job = {
  id: string;
  type: string;
  state: JobState;
  stage: string;
  progress: number;
  processed: number;
  total: number;
  result: JsonObject;
  checkpoint: JsonObject;
  error: JsonObject;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
};

export type V2Approval = {
  id: string;
  actionType: string;
  entityType: string;
  entityId: string | null;
  title: string;
  summary: string;
  payload: JsonObject;
  evidence: unknown[];
  confidence: number | null;
  state: ApprovalState;
  createdAt: string;
  createdBy: number | null;
  createdByName: string | null;
};

export type QuestionSearchFilters = {
  stage?: string;
  grade?: string;
  textbookVersion?: string;
  volume?: string;
  unit?: string;
  topic?: string;
  knowledge?: string[];
  questionType?: string;
  difficulty?: number;
  region?: string;
  year?: number;
  source?: string;
  status?: string;
};

export type QuestionSearchRequest = {
  query: string;
  mode: SearchMode;
  phase?: "lexical" | "semantic";
  filters?: QuestionSearchFilters;
  cursor?: string;
  pageSize?: number;
  useCase?: "browse" | "lesson" | "paper" | "remediation";
};

export const isJobState = (value: unknown): value is JobState => jobStates.includes(value as JobState);
export const isApprovalState = (value: unknown): value is ApprovalState => approvalStates.includes(value as ApprovalState);
export const isSearchMode = (value: unknown): value is SearchMode => searchModes.includes(value as SearchMode);

export function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function parseJsonObject(value: unknown): JsonObject {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
