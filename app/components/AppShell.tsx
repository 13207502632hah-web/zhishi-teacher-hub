"use client";

import Link from "@/app/components/HardNavigationLink";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useSessionState } from "./SessionProvider";
import {
  navigationForRole,
  utilitiesForRole,
} from "./navigation";
import {
  NavigationIcon,
  WorkspaceNavigation,
} from "./WorkspaceNavigation";

export function AppShell({ title, subtitle, actions, children, publicLanding = false }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; publicLanding?: boolean }) {
  const pathname = usePathname();
  const [todoOpen, setTodoOpen] = useState(false);
  const [todos, setTodos] = useState<Record<string, number> | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const { session, sessionError } = useSessionState();
  const publicPage = pathname === "/" || pathname === "/resources";
  const toggleTodos = async () => { const next = !todoOpen; setTodoOpen(next); if (next && !todos) { const response = await fetch("/api/dashboard"); if (response.ok) setTodos(await response.json()); } };
  useEffect(() => { const handleShortcut = (event: KeyboardEvent) => { if (!publicPage && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); return; } if (event.key !== "Escape") return; if (commandOpen) { event.preventDefault(); setCommandOpen(false); return; } const button = document.querySelector<HTMLButtonElement>(".modalBackdrop .modalTitle button"); if (button) { event.preventDefault(); button.click(); } }; document.addEventListener("keydown", handleShortcut); return () => document.removeEventListener("keydown", handleShortcut); }, [commandOpen, publicPage]);
  if (!publicPage && !session?.authenticated) return <div className="authGate"><span>知</span><h1>{sessionError ? "暂时无法确认登录状态" : "请登录教师管理工作台"}</h1><p>{sessionError ? "请检查网络后刷新页面；个人教学数据不会在无法确认身份时显示。" : "资源中心仍可公开浏览；学生姓名、评价和反馈仅供教师管理员登录后查看。"}</p><Link className="primaryButton" href={`/teacher-login?return_to=${encodeURIComponent(pathname)}`}>教师管理员登录</Link><Link className="gateLink" href="/resources">先浏览公开资源</Link></div>;
  if (!publicPage && ["student", "parent"].includes(session?.role || "") && pathname !== "/portal") return <div className="authGate"><span>知</span><h1>当前为{session?.roleName || "受限"}视图</h1><p>只能查看与本人或孩子关联且经教师确认的内容。</p><Link className="primaryButton" href="/portal">进入我的学习</Link></div>;
  if (publicPage) return <><a className="skipLink" href="#main-content">跳到主要内容</a><div className={`publicShell${publicLanding ? " publicShell--landing" : ""}`}><header className="publicHeader"><Link href="/" className="publicBrand"><span>知</span><div><b>知师研室</b><small>莫老师的政治教学与资源空间</small></div></Link><nav aria-label="公开导航"><Link href="/">首页</Link><Link href="/resources">公开资源</Link><Link href="/resources#teaching-method">教学理念</Link><Link className="workspaceEntry" href="/workspace">{session?.authenticated ? "进入工作台" : "教师登录"}</Link></nav></header>{!publicLanding && <div className="publicPageHead"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div>{session?.authenticated && actions && <div className="headerActions">{actions}</div>}</div>}<main className={`publicContent${publicLanding ? " publicContent--landing" : ""}`} id="main-content">{children}</main><footer className="publicFooter"><b>知师研室</b><span>公开资源与私人教学记录严格分离</span><Link href="/workspace">教师工作台</Link></footer></div></>;
  const visibleItems = navigationForRole(session?.role);
  const visibleUtilities = utilitiesForRole(session?.role);
  const commandItems = visibleItems.filter((item) => `${item.label} ${item.group} ${item.href}`.toLowerCase().includes(commandQuery.trim().toLowerCase()));
  return <><a className="skipLink" href="#main-content">跳到主要内容</a><div className="appShell">
    <WorkspaceNavigation items={visibleItems} pathname={pathname} session={session} utilityItems={visibleUtilities} />
    <div className="appMain">
      <header className="appHeader"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div><div className="headerActions">{(!publicPage || session?.authenticated) && actions}<button className="commandTrigger" aria-label="快速跳转，快捷键 Command 或 Control 加 K" onClick={() => setCommandOpen(true)}><span>快速跳转</span><kbd>⌘K</kbd></button>{session?.authenticated && <button className="iconButton" aria-label="教学待办" aria-expanded={todoOpen} onClick={toggleTodos}>◌</button>}{todoOpen && <section className="todoPopover" aria-label="教学待办列表"><div><b>教学待办</b><button aria-label="关闭待办" onClick={() => setTodoOpen(false)}>×</button></div>{!todos ? <p>正在读取…</p> : <ul><li><Link href="/lessons">待处理课时</Link><b>{todos.draftLessons || 0}</b></li><li><Link href="/feedback">待确认反馈</Link><b>{todos.pendingFeedback || 0}</b></li><li><Link href="/questions?status=review">待校对题目</Link><b>{todos.pendingReview || 0}</b></li><li><Link href="/assignments">作业待批改</Link><b>{todos.pendingHomework || 0}</b></li></ul>}</section>}</div></header>
      <main className="appContent" id="main-content">{children}</main>
    </div>
  </div>{commandOpen && <div className="modalBackdrop quickSwitcherBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCommandOpen(false); }}><section className="quickSwitcher" role="dialog" aria-modal="true" aria-label="快速跳转"><div className="quickSwitcherSearch"><span aria-hidden="true">⌕</span><input autoFocus value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} placeholder="搜索题库、课时、学生、反馈或设置" aria-label="搜索工作台入口" /><button aria-label="关闭快速跳转" onClick={() => setCommandOpen(false)}>ESC</button></div><div className="quickSwitcherResults">{commandItems.length ? commandItems.map((item) => <Link key={item.href} href={item.href} onClick={() => { setCommandOpen(false); setCommandQuery(""); }}><NavigationIcon value={item.icon} /><span><b>{item.label}</b><small>{item.group}</small></span><em>打开</em></Link>) : <p>没有匹配入口，请尝试“题库”“课时”或“学生”。</p>}</div><footer><span>按 ⌘K / Ctrl+K 随时打开</span><span>ESC 关闭</span></footer></section></div>}</>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="emptyState"><span>＋</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function PlaceholderPage({ title, description, phase }: { title: string; description: string; phase: string }) {
  return <AppShell title={title} subtitle={description}><EmptyState title={`${title}尚无记录`} description={`${phase}将开放此模块。完成前不会展示虚构数据。`} /></AppShell>;
}
