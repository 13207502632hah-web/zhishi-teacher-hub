import type { Metadata, Viewport } from "next";
import { SessionProvider } from "./components/SessionProvider";
import { getAccess, roleName } from "./lib/access";
import { BRAND_NAME, METADATA_DESCRIPTION, METADATA_TITLE } from "./lib/brand";
import "./globals.css";
import "./responsive-fixes.css";
import "./question-bank.css";
import "./ui-foundations.css";
import "./class-picker.css";
import "./workspace-navigation.css";
import "./public-entry.css";
import "./dashboard.css";
import "./lessons.css";
import "./lesson-detail.css";
import "./assignments.css";
import "./feedback.css";
import "./assessments-list.css";
import "./assessment-detail.css";
import "./feedback-imports.css";
import "./schedule-imports.css";
import "./calendar.css";
import "./questions-list.css";
import "./paper-workbench.css";
import "./paper-detail.css";
import "./classes-overview.css";
import "./class-detail.css";
import "./students-overview.css";

export const metadata: Metadata = {
  title: METADATA_TITLE,
  description: METADATA_DESCRIPTION,
  openGraph: {
    title: `${BRAND_NAME}｜让教学准备，更从容一点`,
    description: METADATA_DESCRIPTION,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME}｜让教学准备，更从容一点`,
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const access = await getAccess();
  const initialSession = access
    ? { authenticated: true, user: { name: access.name, email: access.email }, role: access.role, roleName: roleName[access.role] }
    : { authenticated: false };

  return (
    <html lang="zh-CN">
      <body><SessionProvider initialSession={initialSession}>{children}</SessionProvider></body>
    </html>
  );
}
