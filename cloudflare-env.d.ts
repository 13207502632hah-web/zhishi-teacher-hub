interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface R2ObjectBody { body: ReadableStream; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string>; arrayBuffer(): Promise<ArrayBuffer>; }
interface R2Bucket {
  put(key: string, value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

declare module "cloudflare:workers" {
  export function waitUntil(promise: Promise<unknown>): void;
  export const env: {
    DB: D1Database;
    FILES: R2Bucket;
    TEACHER_ADMIN_ACCOUNT?: string;
    TEACHER_ADMIN_PASSWORD?: string;
    TEACHER_ADMIN_SESSION_SECRET?: string;
    WECHAT_APP_ID?: string;
    WECHAT_APP_SECRET?: string;
    WECHAT_TEST_MODE?: string;
    MINI_FEATURE_ENABLED?: string;
    RECOGNITION_PROVIDER?: string;
    RECOGNITION_API_KEY?: string;
    DEEPSEEK_API_KEY?: string;
    DEEPSEEK_API_BASE?: string;
    DEEPSEEK_AI_ENABLED?: string;
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_FAST_MODEL?: string;
    OPENAI_REASONING_MODEL?: string;
    OPENAI_VISION_MODEL?: string;
    OPENAI_EMBEDDING_MODEL?: string;
    AI_V2_ENABLED?: string;
    VECTOR_SEARCH_URL?: string;
    VECTOR_SEARCH_API_KEY?: string;
  };
}
