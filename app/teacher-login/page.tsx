"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function TeacherLoginPage() {
  const searchParams = useSearchParams();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestedReturnTo = searchParams.get("return_to") || "/workspace";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true); setMessage("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account, password, returnTo: requestedReturnTo }) });
      const payload = await response.json() as { error?: string; returnTo?: string };
      if (!response.ok) { setMessage(payload.error || "暂时无法登录，请稍后重试"); return; }
      window.location.assign(payload.returnTo || "/workspace");
    } catch {
      setMessage("网络连接异常，请检查后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="teacherLogin"><section className="teacherLoginCard" aria-labelledby="teacher-login-title"><span aria-hidden="true">知</span><p>知师研室 · 教师专用入口</p><h1 id="teacher-login-title">教师管理员登录</h1><small>登录后可管理课时、学生、题库、反馈和教学数据。</small><form onSubmit={submit}><label>管理员账号<input value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" inputMode="numeric" required /></label><label>登录密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{message && <div className="formError" role="alert">{message}</div>}<button className="primaryButton" disabled={submitting}>{submitting ? "正在登录…" : "进入教师工作台"}</button></form><a href="/resources">返回公开资源中心</a></section></main>;
}
