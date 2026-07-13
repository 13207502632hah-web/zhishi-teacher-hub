import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { feedbackTemplates } from "../../../../db/schema";
import { audit, isDenied, requirePermission } from "../../../lib/access";

export async function GET() {
  const access = await requirePermission("feedback:read"); if (isDenied(access)) return access;
  const templates = await getDb().select().from(feedbackTemplates).where(eq(feedbackTemplates.status, "active")).orderBy(desc(feedbackTemplates.isDefault), desc(feedbackTemplates.updatedAt));
  return Response.json({ templates });
}

export async function POST(request: Request) {
  const access = await requirePermission("feedback:write"); if (isDenied(access)) return access;
  const body = await request.json() as Record<string, unknown>, name = String(body.name || "").trim();
  if (!name) return Response.json({ error: "模板名称不能为空" }, { status: 400 });
  const [template] = await getDb().insert(feedbackTemplates).values({ name, audience: String(body.audience || "private"), tone: String(body.tone || "温和鼓励"), opening: String(body.opening || ""), closing: String(body.closing || ""), styleRules: String(body.styleRules || ""), exampleText: String(body.exampleText || ""), isDefault: body.isDefault === true }).returning();
  await audit(access, "create", "feedback_template", template.id);
  return Response.json({ template }, { status: 201 });
}

