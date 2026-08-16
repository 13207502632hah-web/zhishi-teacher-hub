import { redirect } from "next/navigation";
import { teacherAdminSignInPath } from "../lib/teacher-auth";
import { getAccess } from "../lib/access";
import { V2Shell } from "./V2Shell";

export const dynamic = "force-dynamic";

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  if (!access || !["teacher", "assistant"].includes(access.role)) redirect(teacherAdminSignInPath("/v2"));
  return <V2Shell userName={access.name || "教师"} role={access.role as "teacher" | "assistant"}>{children}</V2Shell>;
}
