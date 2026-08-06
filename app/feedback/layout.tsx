import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function FeedbackLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/feedback");
  return children;
}
