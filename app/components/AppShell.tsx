"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const items = [
  ["/", "⌂", "工作台"], ["/lessons", "◷", "课时记录"], ["/classes", "♙", "学生与班级"],
  ["/questions", "▤", "题库与组卷"], ["/feedback", "✉", "课程反馈"], ["/reflections", "◇", "教学反思"],
  ["/analytics", "▥", "数据中心"], ["/resources", "▦", "资源中心"], ["/settings", "⚙", "设置"],
];

export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  return <div className="appShell">
    <aside className="sideNav">
      <Link href="/" className="appBrand"><span>知</span><div><b>知师研室</b><small>政治教学工作台</small></div></Link>
      <nav>{items.map(([href, icon, label]) => <Link key={href} href={href} className={pathname === href || (href !== "/" && pathname.startsWith(href)) ? "active" : ""}><i>{icon}</i>{label}</Link>)}</nav>
      <div className="sideUser"><span>莫</span><div><b>莫老师</b><small>教师 · 个人工作区</small></div></div>
    </aside>
    <div className="appMain">
      <header className="appHeader"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div><div className="headerActions">{actions}<button className="iconButton" aria-label="通知">◌</button></div></header>
      <div className="appContent">{children}</div>
    </div>
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="emptyState"><span>＋</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function PlaceholderPage({ title, description, phase }: { title: string; description: string; phase: string }) {
  return <AppShell title={title} subtitle={description}><EmptyState title={`${title}尚无记录`} description={`${phase}将开放此模块。完成前不会展示虚构数据。`} /></AppShell>;
}
