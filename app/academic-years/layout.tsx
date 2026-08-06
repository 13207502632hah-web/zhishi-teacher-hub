import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function AcademicYearsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/academic-years");
  return children;
}
