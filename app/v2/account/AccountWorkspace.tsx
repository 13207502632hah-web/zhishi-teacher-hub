"use client";

import Link from "../../components/HardNavigationLink";
import { FormEvent, useState } from "react";

type User = { name: string; email: string; role: string; authType: string };

export function AccountWorkspace({ user }: { user: User }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, fields = Object.fromEntries(new FormData(form).entries());
    try { const response = await fetch("/api/auth/staff-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) }), payload = await response.json().catch(() => ({})) as Record<string, unknown>; if (!response.ok) throw new Error(String(payload.error || "密码修改失败")); form.reset(); setNotice(String(payload.message || "密码已更新")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "密码修改失败"); }
    finally { setBusy(false); }
  };
  return <div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>当前登录身份</h2><p>会话最长 12 小时，账号停用或重设密码会立即撤销旧会话</p></div><span className="v2-status completed">已登录</span></header><div className="v2-calendar-state"><span>{user.name.slice(0, 1)}</span><div><h3>{user.name}</h3><p>{user.email} · {user.role === "assistant" ? "助教" : "主教师"}</p></div></div><a className="v2-danger-action" href="/api/auth/logout?return_to=/teacher-login">安全退出所有当前浏览器会话</a></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>修改登录密码</h2><p>新密码至少 12 位，并包含多类字符</p></div></header>{user.authType === "staff" ? <form className="v2-form" onSubmit={submit}><label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required/></label><label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required/></label><label>再次输入新密码<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required/></label>{error && <small className="v2-form-error">{error}</small>}{notice && <p className="v2-alert">{notice}</p>}<button className="v2-primary" disabled={busy}>{busy ? "正在更新…" : "更新密码并撤销旧会话"}</button></form> : <div className="v2-empty"><b>主教师管理员密码</b>管理员密码继续由主教师安全设置管理。<Link className="v2-row-action" href="/settings">打开主教师安全设置</Link></div>}</section></div>;
}
