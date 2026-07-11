"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const items = [
  ["/workspace", "⌂", "工作台"], ["/lessons", "◷", "课时记录"], ["/classes", "♙", "学生与班级"],
  ["/questions", "▤", "题库与组卷"], ["/feedback", "✉", "课程反馈"], ["/reflections", "◇", "教学反思"],
  ["/analytics", "▥", "数据中心"], ["/resources", "▦", "资源中心"], ["/settings", "⚙", "设置"],
];

type Session = { authenticated: boolean; user?: { name: string; email: string }; role?: string; roleName?: string };

export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const publicPage = pathname === "/" || pathname === "/resources";
  useEffect(() => {
    let active = true;
    fetch("/api/session")
      .then(async (response) => response.ok ? response.json() : { authenticated: false })
      .then((value) => { if (active) setSession(value); })
      .catch(() => { if (active) { setSession({ authenticated: false }); setSessionError(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key !== "Escape") return; const button = document.querySelector<HTMLButtonElement>(".modalBackdrop .modalTitle button"); if (button) { event.preventDefault(); button.click(); } }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, []);
  if (!publicPage && session === null) return <div className="authGate"><span>知</span><h1>正在确认工作区身份</h1><p>个人教学记录属于敏感数据，请稍候。</p></div>;
  if (!publicPage && !session?.authenticated) return <div className="authGate"><span>知</span><h1>{sessionError ? "暂时无法确认登录状态" : "请登录教师管理工作台"}</h1><p>{sessionError ? "请检查网络后刷新页面；个人教学数据不会在无法确认身份时显示。" : "资源中心仍可公开浏览；学生姓名、评价和反馈仅供教师管理员登录后查看。"}</p><Link className="primaryButton" href={`/teacher-login?return_to=${encodeURIComponent(pathname)}`}>教师管理员登录</Link><Link className="gateLink" href="/resources">先浏览公开资源</Link></div>;
  if (!publicPage && ["student", "parent"].includes(session?.role || "") && pathname !== "/portal") return <div className="authGate"><span>知</span><h1>当前为{session?.roleName || "受限"}视图</h1><p>只能查看与本人或孩子关联且经教师确认的内容。</p><Link className="primaryButton" href="/portal">进入我的学习</Link></div>;
  const visibleItems = !session?.authenticated && publicPage ? [["/", "⌂", "公开首页"], ["/resources", "▦", "资源中心"], ["/workspace", "↗", "教师工作台"]] : session?.role === "assistant" ? items.filter(([href]) => !["/reflections", "/analytics", "/settings"].includes(href)) : ["student", "parent"].includes(session?.role || "") ? [["/portal", "◎", "我的学习"], ["/resources", "▦", "资源中心"]] : items;
  return <><a className="skipLink" href="#main-content">跳到主要内容</a><div className="appShell">
    <aside className="sideNav">
      <Link href="/" className="appBrand"><span>知</span><div><b>知师研室</b><small>政治教学工作台</small></div></Link>
      <nav aria-label="主导航">{visibleItems.map(([href, icon, label]) => { const active = pathname === href || (href !== "/" && pathname.startsWith(href)); return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><i aria-hidden="true">{icon}</i>{label}</Link>; })}</nav>
      <div className="sideUser"><span>{session?.user?.name?.slice(0, 1) || "访"}</span><div><b>{session?.user?.name || "公开访客"}</b><small>{session?.roleName || "公开资源"} · {session?.authenticated ? "个人工作区" : "只读"}</small></div>{session?.authenticated && <Link aria-label="退出登录" href="/api/auth/logout?return_to=%2Fresources">退出</Link>}</div>
    </aside>
    <div className="appMain">
      <header className="appHeader"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div><div className="headerActions">{(!publicPage || session?.authenticated) && actions}<button className="iconButton" aria-label="通知">◌</button></div></header>
      <main className="appContent" id="main-content">{children}</main>
    </div>
  </div></>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="emptyState"><span>＋</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function PlaceholderPage({ title, description, phase }: { title: string; description: string; phase: string }) {
  return <AppShell title={title} subtitle={description}><EmptyState title={`${title}尚无记录`} description={`${phase}将开放此模块。完成前不会展示虚构数据。`} /></AppShell>;
}
