import { GET as getRecognition, POST as mutateRecognition } from "../route";

const idFrom = async (context: { params: Promise<{ id: string }> }) => Number((await context.params).id);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = await idFrom(context);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "校对任务编号无效" }, { status: 400 });
  const url = new URL(request.url); url.searchParams.set("id", String(id));
  return getRecognition(new Request(url, { headers: request.headers }));
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = await idFrom(context);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "校对任务编号无效" }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action === "aiRecognize" ? "aiRecognize" : "save";
  return mutateRecognition(new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json", "X-Operation-Id": request.headers.get("x-operation-id") || "" }, body: JSON.stringify({ ...body, action, jobId: id }) }));
}
