import { isDenied, requirePermission } from "../../../../lib/access";
import { searchQuestionsV2 } from "../../../../lib/v2/question-search";

export async function POST(request: Request) {
  const access = await requirePermission("questions:read");
  if (isDenied(access)) return access;
  try {
    return Response.json(await searchQuestionsV2(access, await request.json()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "题库检索失败" }, { status: 500 });
  }
}
