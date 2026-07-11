import { requireTeacherAdmin } from "../lib/teacher-auth";
import { Dashboard } from "../page";

// This page is the secure entry point for the personal workspace. Keeping the
// redirect on the server preserves `/workspace` through administrator login.
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  await requireTeacherAdmin("/workspace");
  return <Dashboard />;
}
