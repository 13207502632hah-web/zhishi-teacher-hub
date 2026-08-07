"use client";

import Link from "@/app/components/HardNavigationLink";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "../../components/AppShell";
import { HttpError, requestJson } from "../../lib/http-client";
import styles from "../resource-detail.module.css";

type Resource = {
  id: number;
  title: string;
  type?: string | null;
  tags?: string | null;
  url?: string | null;
  content?: string | null;
  sourceRef?: string | null;
  visibility?: string | null;
};

type DetailPayload = {
  resource: Resource;
};

const safeProtocols = ["http:", "https:"];

function safeExternalUrl(value: string | null | undefined) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return safeProtocols.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type DetailStatus = "loading" | "ready" | "missing" | "error";

export default function PublicResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [resource, setResource] = useState<Resource | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    setStatus("loading");
    setMessage("");
    try {
      const payload = await requestJson<DetailPayload>(`/api/resources/${encodeURIComponent(id)}`, { signal });
      if (!payload?.resource) throw new HttpError(200, "资源详情返回了无法识别的数据");
      setResource(payload.resource);
      setStatus("ready");
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof HttpError && error.status === 404) {
        setStatus("missing");
      } else {
        setStatus("error");
        setMessage(error instanceof HttpError ? error.message : "资源详情暂时无法读取，请稍后重试");
      }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, retryKey]);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setMessage("复制失败，请直接复制地址栏中的链接");
    }
  };

  const externalUrl = resource ? safeExternalUrl(resource.url) : null;

  return <AppShell title="公开资源详情" subtitle="匿名可读的公开资源；私有资源不会向访客开放">
    <div className={styles.page}>
      {status === "loading" && <div className={styles.statePanel} role="status"><strong>正在读取资源详情</strong><span>正在确认该资源是否公开可读；不会向访客展示私有内容。</span></div>}
      {status === "missing" && <div className={`${styles.statePanel} ${styles.stateError}`} role="alert"><strong>该资源不存在或未公开</strong><span>私有资源仅教师与助教可见；可以返回公开资源中心继续检索。</span><Link className={styles.secondaryButton} href="/resources">返回公开资源中心</Link></div>}
      {status === "error" && <div className={`${styles.statePanel} ${styles.stateError}`} role="alert"><strong>资源详情暂时无法读取</strong><span>{message}</span><button type="button" className={styles.secondaryButton} onClick={() => setRetryKey((value) => value + 1)}>重新读取</button></div>}
      {status === "ready" && resource && <article className={styles.card}>
        <div className={styles.cardMeta}>
          <span className={styles.badge}>{resource.type || "资源"}</span>
          <span className={styles.visibilityBadge}>{resource.visibility === "public" ? "公开资源" : "仅教师与助教"}</span>
          {resource.sourceRef?.startsWith("reflection:") && <span className={styles.badgeMuted}>来自教学反思</span>}
        </div>
        <h1>{resource.title}</h1>
        {resource.tags && <p className={styles.tags}>{resource.tags}</p>}
        <p className={styles.content}>{resource.content || "该资源暂未填写内容说明。"}</p>
        {resource.url && !externalUrl && <p className={styles.linkWarning} role="note">链接未显示：仅支持 http:// 或 https:// 安全协议。</p>}
        <div className={styles.actions}>
          <Link className={styles.secondaryButton} href="/resources">返回资源中心</Link>
          <button type="button" className={styles.primaryButton} onClick={() => void copyShareLink()}>{copied ? "已复制分享链接" : "复制分享链接"}</button>
          {externalUrl && <a className={styles.textButton} href={externalUrl} target="_blank" rel="noopener noreferrer">打开安全链接</a>}
        </div>
        {message && <p className={styles.inlineNotice} role="status">{message}</p>}
      </article>}
      {status === "ready" && resource && <section className={styles.boundaryNote} aria-labelledby="detail-boundary-title">
        <p className={styles.eyebrow}>公开边界</p>
        <h2 id="detail-boundary-title">分享内容前，教师已完成公开检查</h2>
        <p>这里只展示教师主动公开且不含学生、家长或私人教学信息的资源；外部链接在新标签页打开，系统不会绕过登录、付费或授权。</p>
      </section>}
    </div>
  </AppShell>;
}
