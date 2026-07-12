import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./responsive-fixes.css";

export const metadata: Metadata = {
  title: "知师研室｜初高中教师教学工作台",
  description: "面向初高中教师的备课、组卷、学情与教研工作台。",
  openGraph: {
    title: "知师研室｜让教学准备，更从容一点",
    description: "面向初高中教师的备课、组卷、学情与教研工作台。",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "知师研室｜让教学准备，更从容一点",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
