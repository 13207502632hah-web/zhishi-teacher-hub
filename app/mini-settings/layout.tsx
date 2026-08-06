import type { ReactNode } from "react";
import { requireTeacherAdmin } from "../lib/teacher-auth";

export const dynamic = "force-dynamic";

export default async function MiniSettingsLayout({ children }: { children: ReactNode }) {
  await requireTeacherAdmin("/mini-settings");
  return children;
}
