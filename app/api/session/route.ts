import { getAccess, roleName } from "../../lib/access";

export async function GET() {
  const access = await getAccess();
  if (!access) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({ authenticated: true, user: { id: access.id, name: access.name, email: access.email }, role: access.role, roleName: roleName[access.role], roles: access.roles });
}
