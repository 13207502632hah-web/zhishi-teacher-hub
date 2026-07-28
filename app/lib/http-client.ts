export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload: unknown = null,
  ) {
    super(message);
    this.name = "HttpError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type RequestJsonInit = RequestInit & {
  timeoutMs?: number;
};

const statusMessage = (status: number) => {
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "暂无权限执行此操作";
  if (status === 404) return "请求的资源不存在";
  if (status === 409) return "数据已发生变化，请刷新后重试";
  if (status === 413) return "提交内容过大，请压缩后重试";
  if (status === 429) return "操作过于频繁，请稍后重试";
  if (status >= 500) return "服务器暂时无法处理请求，请稍后重试";
  return "请求失败，请稍后重试";
};

const errorMessageFromPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const value of [record.error, record.message]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
};

const parseJson = (body: string) => {
  try {
    return { parsed: true as const, value: JSON.parse(body) as unknown };
  } catch {
    return { parsed: false as const, value: null };
  }
};

export async function requestJson<T>(input: RequestInfo | URL, init: RequestJsonInit = {}): Promise<T | null> {
  const { timeoutMs = 15_000, signal: callerSignal, ...fetchInit } = init;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutError: HttpError | undefined;

  const abortForCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) abortForCaller();
    else callerSignal.addEventListener("abort", abortForCaller, { once: true });
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timeoutError = new HttpError(0, "请求超时，请稍后重试");
      controller.abort(timeoutError);
    }, timeoutMs);
  }

  try {
    const response = await fetch(input, { ...fetchInit, signal: controller.signal });
    const body = response.status === 204 ? "" : await response.text();
    const trimmedBody = body.trim();

    if (response.ok) {
      if (!trimmedBody) return null;
      const json = parseJson(trimmedBody);
      if (json.parsed) return json.value as T;
      throw new HttpError(response.status, "服务器返回了无法识别的数据");
    }

    const json = trimmedBody ? parseJson(trimmedBody) : { parsed: false as const, value: null };
    const payload = json.parsed ? json.value : null;
    throw new HttpError(response.status, errorMessageFromPayload(payload) ?? statusMessage(response.status), payload);
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (timeoutError) throw timeoutError;
    if (error instanceof HttpError) throw error;
    throw new HttpError(0, "网络连接异常，请检查后重试");
  } finally {
    if (timer) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortForCaller);
  }
}
