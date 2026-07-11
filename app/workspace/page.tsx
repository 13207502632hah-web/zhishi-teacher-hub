import { requireChatGPTUser } from "../chatgpt-auth";
import { Dashboard } from "../page";

// This page is the secure entry point for the personal workspace.  Keeping the
// sign-in redirect on the server lets Sites preserve `/workspace` through the
// ChatGPT sign-in flow instead of relying on a client-side handoff.
export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  await requireChatGPTUser("/workspace");
  return <Dashboard />;
}
