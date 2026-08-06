import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function ExamProjectsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/exam-projects");
  return children;
}
