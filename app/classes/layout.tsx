import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function ClassesLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/classes");
  return children;
}
