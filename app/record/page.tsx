import { redirect } from "next/navigation";
import { getAccess } from "../lib/access";
import { teacherAdminSignInPath } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function MobileRecordEntryPage() {
  const access = await getAccess();
  redirect(access && ["teacher", "assistant"].includes(access.role)
    ? "/v2/record"
    : teacherAdminSignInPath("/v2/record"));
}
