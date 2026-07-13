"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useSessionState } from "./SessionProvider";

type NavItem = { href: string; icon: string; label: string; group: string };
const items: NavItem[] = [
  { href: "/workspace", icon: "首", label: "工作台", group: "总览" },
  { href: "/lessons", icon: "课", label: "课时记录", group: "教学管理" },
  { href: "/schedule-imports", icon: "表", label: "课表导入", group: "教学管理" },
  { href: "/finance", icon: "账", label: "课时结算", group: "教学管理" },
  { href: "/calendar", icon: "历", label: "Apple 日历", group: "教学管理" },
  { href: "/feedback", icon: "馈", label: "课程反馈", group: "教学管理" },
  { href: "/assignments", icon: "业", label: "作业中心", group: "教学管理" },
  { href: "/classes", icon: "班", label: "学生与班级", group: "学生学情" },
  { href: "/assessments", icon: "测", label: "测验与成绩", group: "学生学情" },
  { href: "/recognition", icon: "校", label: "答题卡校对", group: "学生学情" },
  { href: "/questions", icon: "题", label: "题库与组卷", group: "题库组卷" },
  { href: "/reflections", icon: "思", label: "教学反思", group: "教研沉淀" },
  { href: "/analytics", icon: "数", label: "数据中心", group: "教研沉淀" },
  { href: "/resources", icon: "资", label: "资源中心", group: "教研沉淀" },
  { href: "/settings", icon: "设", label: "设置", group: "系统" },
  { href: "/mini-settings", icon: "微", label: "微信小程序", group: "系统" },
];

export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [todoOpen, setTodoOpen] = useState(false);
  const [todos, setTodos] = useState<Record<string, number> | null>(null);
  const { session, sessionError } = useSessionState();
  const publicPage = pathname === "/" || pathname === "/resources";
  const transitionTo = (href: string, preventDefault: () => void) => {
    if (href === pathname) return;
    preventDefault();
    startTransition(() => router.push(href));
  };
  const toggleTodos = async () => { const next = !todoOpen; setTodoOpen(next); if (next && !todos) { const response = await fetch("/api/dashboard"); if (response.ok) setTodos(await response.json()); } };
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key !== "Escape") return; const button = document.querySelector<HTMLButtonElement>(".modalBackdrop .modalTitle button"); if (button) { event.preventDefault(); button.click(); } }; document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, []);
  if (!publicPage && session === null) return <div className="authGate"><span>知</span><h1>正在确认工作区身份</h1><p>个人教学记录属于敏感数据，请稍候。</p></div>;
  if (!publicPage && !session?.authenticated) return <div className="authGate"><span>知</span><h1>{sessionError ? "暂时无法确认登录状态" : "请登录教师管理工作台"}</h1><p>{sessionError ? "请检查网络后刷新页面；个人教学数据不会在无法确认身份时显示。" : "资源中心仍可公开浏览；学生姓名、评价和反馈仅供教师管理员登录后查看。"}</p><Link className="primaryButton" href={`/teacher-login?return_to=${encodeURIComponent(pathname)}`}>教师管理员登录</Link><Link className="gateLink" href="/resources">先浏览公开资源</Link></div>;
  if (!publicPage && ["student", "parent"].includes(session?.role || "") && pathname !== "/portal") return <div className="authGate"><span>知</span><h1>当前为{session?.roleName || "受限"}视图</h1><p>只能查看与本人或孩子关联且经教师确认的内容。</p><Link className="primaryButton" href="/portal">进入我的学习</Link></div>;
  if (publicPage) return <><a className="skipLink" href="#main-content">跳到主要内容</a><div className="publicShell"><header className="publicHeader"><Link href="/" className="publicBrand"><span>知</span><div><b>知师研室</b><small>莫老师的政治教学与资源空间</small></div></Link><nav aria-label="公开导航"><Link href="/">首页</Link><Link href="/resources">公开资源</Link><a href="/resources#teaching-method">教学理念</a><Link className="workspaceEntry" href="/workspace">{session?.authenticated ? "进入工作台" : "教师登录"}</Link></nav></header><div className="publicPageHead"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div>{session?.authenticated && actions && <div className="headerActions">{actions}</div>}</div><main className="publicContent" id="main-content">{children}</main><footer className="publicFooter"><b>知师研室</b><span>公开资源与私人教学记录严格分离</span><Link href="/workspace">教师工作台</Link></footer></div></>;
  const visibleItems = session?.role === "assistant" ? items.filter((item) => !["/reflections", "/analytics", "/settings"].includes(item.href)) : ["student", "parent"].includes(session?.role || "") ? [{ href: "/portal", icon: "学", label: "我的学习", group: "学习" }, { href: "/resources", icon: "资", label: "资源中心", group: "学习" }] : items;
  const groups = [...new Set(visibleItems.map((item) => item.group))];
  return <><a className="skipLink" href="#main-content">跳到主要内容</a><div className="appShell">
    <aside className="sideNav">
      <Link href="/" className="appBrand"><span>知</span><div><b>知师研室</b><small>政治教学工作台</small></div></Link>
      <nav aria-label="主导航" aria-busy={isPending}>{groups.map((group) => <section className="navGroup" key={group}><b>{group}</b>{visibleItems.filter((item) => item.group === group).map(({ href, icon, label }) => { const active = pathname === href || (href !== "/" && pathname.startsWith(href)); return <Link key={href} href={href} onNavigate={(event) => transitionTo(href, () => event.preventDefault())} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><NavIcon value={icon} />{label}</Link>; })}</section>)}</nav>
      <div className="sideUser"><span>{session?.user?.name?.slice(0, 1) || "访"}</span><div><b>{session?.user?.name || "公开访客"}</b><small>{session?.roleName || "公开资源"} · {session?.authenticated ? "个人工作区" : "只读"}</small></div>{session?.authenticated && <Link aria-label="退出登录" href="/api/auth/logout?return_to=%2Fresources">退出</Link>}</div>
    </aside>
    <div className="appMain">
      <header className="appHeader"><div><p>知师研室 / {title}</p><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}</div><div className="headerActions">{(!publicPage || session?.authenticated) && actions}{session?.authenticated && <button className="iconButton" aria-label="教学待办" aria-expanded={todoOpen} onClick={toggleTodos}>◌</button>}{todoOpen && <section className="todoPopover" aria-label="教学待办列表"><div><b>教学待办</b><button aria-label="关闭待办" onClick={() => setTodoOpen(false)}>×</button></div>{!todos ? <p>正在读取…</p> : <ul><li><Link href="/lessons">待处理课时</Link><b>{todos.draftLessons || 0}</b></li><li><Link href="/feedback">待确认反馈</Link><b>{todos.pendingFeedback || 0}</b></li><li><Link href="/questions?status=review">待校对题目</Link><b>{todos.pendingReview || 0}</b></li><li><Link href="/assignments">作业待批改</Link><b>{todos.pendingHomework || 0}</b></li></ul>}</section>}</div></header>
      <main className="appContent" id="main-content">{children}</main>
    </div>
  </div></>;
}

function NavIcon({ value }: { value: string }) { return <i className="navIcon" aria-hidden="true">{value}</i>; }

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="emptyState"><span>＋</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function PlaceholderPage({ title, description, phase }: { title: string; description: string; phase: string }) {
  return <AppShell title={title} subtitle={description}><EmptyState title={`${title}尚无记录`} description={`${phase}将开放此模块。完成前不会展示虚构数据。`} /></AppShell>;
}
