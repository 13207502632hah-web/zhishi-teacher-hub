import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function ReflectionsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/reflections");
  return children;
}
