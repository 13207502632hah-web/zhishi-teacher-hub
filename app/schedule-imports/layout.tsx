import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function ScheduleImportsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/schedule-imports");
  return children;
}
