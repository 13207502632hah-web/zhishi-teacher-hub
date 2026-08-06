import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/settings");
  return children;
}
