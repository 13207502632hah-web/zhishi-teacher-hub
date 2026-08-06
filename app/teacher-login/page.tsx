"use client";

import Link from "@/app/components/HardNavigationLink";
import { HttpError, requestJson } from "@/app/lib/http-client";
import { BRAND_MARK, BRAND_NAME, WORKSPACE_TITLE } from "@/app/lib/brand";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

type LoginResponse = { returnTo?: string };

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
      const payload = await requestJson<LoginResponse>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password, returnTo: requestedReturnTo }),
      });
      if (!payload) throw new HttpError(200, "登录响应为空，请重试");
      window.location.assign(payload.returnTo || "/workspace");
    } catch (error) {
      setMessage(error instanceof HttpError ? error.message : "暂时无法登录，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="teacherLogin">
    <Link className="teacherLoginBrand" href="/" aria-label={`返回${BRAND_NAME}首页`}><span aria-hidden="true">{BRAND_MARK}</span><div><b>{BRAND_NAME}</b><small>{WORKSPACE_TITLE}</small></div></Link>
    <div className="teacherLoginLayout">
      <section className="teacherLoginStory" aria-labelledby="teacher-login-story-title">
        <p>静雅备课室</p>
        <h2 id="teacher-login-story-title">回到今天的教学现场。</h2>
        <span>这里保存课时、题目、学生表现与教师反馈。每一条教学结论都保留依据，重要操作都需要教师确认。</span>
        <ol aria-label="教学闭环">
          {["备课", "上课", "作业", "反馈", "结算"].map((item, index) => <li key={item}><b>{String(index + 1).padStart(2, "0")}</b><span>{item}</span></li>)}
        </ol>
      </section>

      <section className="teacherLoginCard" aria-labelledby="teacher-login-title">
        <p>教师专用入口</p>
        <h1 id="teacher-login-title">教师管理员登录</h1>
        <span className="teacherLoginIntro">登录后进入个人工作区。学生、家长和公开访客无法通过此入口查看教师数据。</span>
        <form onSubmit={submit}>
          <label htmlFor="teacher-account">管理员账号</label>
          <input id="teacher-account" type="text" value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="teacher-login-account-hint" required />
          <small id="teacher-login-account-hint">请输入配置的教师管理员账号，可包含字母、数字或符号。</small>
          <label htmlFor="teacher-password">登录密码</label>
          <input id="teacher-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          {message && <div className="formError" role="alert">{message}</div>}
          <button className="publicHomePrimary" disabled={submitting}>{submitting ? "正在验证…" : "进入教师工作台"}<span aria-hidden="true">→</span></button>
        </form>
        <div className="teacherLoginLinks"><Link href="/">返回首页</Link><Link href="/resources">浏览公开资源</Link></div>
      </section>
    </div>
    <p className="teacherLoginPrivacy">公开资源与私人教学记录严格分离</p>
  </main>;
}
