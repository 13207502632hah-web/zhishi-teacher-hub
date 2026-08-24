import type { Metadata, Viewport } from "next";
import { SessionProvider } from "./components/SessionProvider";
import { PwaRegister } from "./components/PwaRegister";
import { getAccess, roleName } from "./lib/access";
import { BRAND_NAME, METADATA_DESCRIPTION, METADATA_TITLE } from "./lib/brand";
import { RELEASE_METADATA_BASE } from "./lib/release-target";
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
import "./questions-list.css";
import "./paper-workbench.css";
import "./paper-detail.css";
import "./classes-overview.css";
import "./class-detail.css";
import "./students-overview.css";
import "./v2/v2.css";

export const metadata: Metadata = {
  ...(RELEASE_METADATA_BASE ? { metadataBase: RELEASE_METADATA_BASE } : {}),
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
    icon: "/app-icon.svg",
    shortcut: "/app-icon.svg",
    apple: "/app-icon.svg",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "知师研室", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
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
      <body><SessionProvider initialSession={initialSession}>{children}</SessionProvider><PwaRegister /></body>
    </html>
  );
}
