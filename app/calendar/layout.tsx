import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function CalendarLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/calendar");
  return children;
}
