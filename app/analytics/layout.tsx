import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/analytics");
  return children;
}
