import { isDenied, requirePermission } from "../../../lib/access";
import { monthlyFinance } from "../../../lib/finance-monthly";

export async function GET(request: Request) {
  const access = await requirePermission("analytics:read"); if (isDenied(access)) return access;
  const month = new URL(request.url).searchParams.get("month") || new Date().toISOString().slice(0, 7);
  return Response.json(await monthlyFinance(month, access));
}
