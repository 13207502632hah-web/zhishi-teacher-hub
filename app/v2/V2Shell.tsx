"use client";

import Link from "../components/HardNavigationLink";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const sections = [
  { label: "今日", items: [{ href: "/v2", icon: "⌂", name: "教学驾驶舱" }, { href: "/v2/record", icon: "记", name: "手机记录" }, { href: "/v2/approvals", icon: "✓", name: "待确认中心" }, { href: "/v2/assistant", icon: "✦", name: "智能助手" }, { href: "/v2/account", icon: "我", name: "账号与安全" }] },
  { label: "教学", items: [{ href: "/v2/schedule-imports", icon: "日", name: "智能课表" }, { href: "/v2/questions", icon: "题", name: "智能题库" }, { href: "/v2/modules/papers", icon: "卷", name: "组卷工作台" }, { href: "/v2/dictations", icon: "听", name: "跟读与听写" }, { href: "/v2/modules/assignments", icon: "业", name: "作业与批改" }, { href: "/v2/toolbox", icon: "具", name: "课堂工具箱" }, { href: "/v2/operations", icon: "测", name: "评测与教学运营", teacherOnly: true }] },
  { label: "工作室", items: [{ href: "/v2/modules/students", icon: "人", name: "学生、班级与课时" }, { href: "/v2/modules/learning", icon: "析", name: "学情与反馈" }, { href: "/v2/notices", icon: "信", name: "家校消息" }, { href: "/v2/class-files", icon: "盘", name: "班级网盘" }, { href: "/v2/modules/resources", icon: "资", name: "资源中心" }, { href: "/v2/modules/finance", icon: "账", name: "财务核对", teacherOnly: true }, { href: "/v2/settings", icon: "设", name: "系统设置", teacherOnly: true }] },
];

export function V2Shell({ userName, role, children }: { userName: string; role: "teacher" | "assistant"; children: React.ReactNode }) {
  const pathname = usePathname(), router = useRouter(), [palette, setPalette] = useState(false), [query, setQuery] = useState("");
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette((value) => !value); } if (event.key === "Escape") setPalette(false); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const visibleSections = sections.map((section) => ({ ...section, items: section.items.filter((item) => role === "teacher" || !item.teacherOnly) })), visibleItems = visibleSections.flatMap((section) => section.items);
  const matches = visibleItems.filter((item) => `${item.name}${item.href}`.toLowerCase().includes(query.toLowerCase()));
  const title = pathname === "/v2/account" ? "账号与安全" : [...visibleItems].sort((a, b) => b.href.length - a.href.length).find((item) => pathname === item.href || (item.href !== "/v2" && pathname.startsWith(item.href)))?.name || "知师研室 2.0";
  return <div className="v2-shell">
    <aside className="v2-sidebar">
      <Link className="v2-brand" href="/v2"><span>知</span><strong>知师研室<small>TEACHER STUDIO 2.0</small></strong></Link>
      <nav aria-label="2.0 工作台导航">{visibleSections.map((section) => <section key={section.label}><p>{section.label}</p>{section.items.map((item) => <Link key={item.href} href={item.href} className={pathname === item.href || (item.href !== "/v2" && pathname.startsWith(item.href)) ? "active" : ""}><i aria-hidden>{item.icon}</i><span>{item.name}</span></Link>)}</section>)}</nav>
      <div className="v2-user"><span>{userName.slice(0, 1)}</span><div><b>{userName}</b><small>{role === "teacher" ? "主教师" : "助教"} · 私人工作室</small></div><Link href="/v2/account" title="账号与安全">•••</Link></div>
    </aside>
    <div className="v2-main">
      <header className="v2-topbar"><div><small>知师研室 2.0 / 私人教学工作室</small><h1>{title}</h1></div><div className="v2-top-actions"><button className="v2-command" onClick={() => setPalette(true)}><span>⌕</span>搜索或执行命令<kbd>Ctrl K</kbd></button><Link className="v2-ai-launch" href="/v2/assistant"><span>✦</span> 问智能助手</Link></div></header>
      <main className="v2-content" id="main-content">{children}</main>
    </div>
    {palette && <div className="v2-dialog-backdrop" role="presentation" onMouseDown={() => setPalette(false)}><section className="v2-command-dialog" role="dialog" aria-modal="true" aria-label="命令面板" onMouseDown={(event) => event.stopPropagation()}><header><span>⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模块、课表、题库，或输入要做的事…"/><kbd>ESC</kbd></header><p>快捷入口</p><div>{matches.map((item) => <button key={item.href} onClick={() => { router.push(item.href); setPalette(false); setQuery(""); }}><i>{item.icon}</i><span><b>{item.name}</b><small>{item.href}</small></span><em>↵</em></button>)}</div><footer>所有正式发布、发送和业务写入仍需在待确认中心核对。</footer></section></div>}
  </div>;
}
