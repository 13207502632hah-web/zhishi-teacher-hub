import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function StudentsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/students");
  return children;
}
