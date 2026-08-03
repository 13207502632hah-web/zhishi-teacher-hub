"use client";

import Link from "@/app/components/HardNavigationLink";
import styles from "./route-states.module.css";
import { useState } from "react";

type RouteError = Error & { digest?: string };

export default function ErrorPage({ reset }: { error: RouteError; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    if (typeof reset === "function") reset();
    else window.location.reload();
  };

  return (
    <main className={styles.routeState} role="alert" aria-live="assertive">
      <section className={styles.routeStatePanel}>
        <span className={styles.routeStateMark} aria-hidden="true">知</span>
        <div className={styles.routeStateCopy}>
          <p className={styles.routeStateEyebrow}>知师研室 / 页面暂时离线</p>
          <h1 className={styles.routeStateTitle}>这个页面暂时没有加载成功</h1>
          <p className={styles.routeStateMessage}>可能是网络波动或服务暂时繁忙。系统不会因为本次失败自动重复提交或修改教学记录。</p>
        </div>
        <div className={styles.routeStateActions}>
          <button className={styles.routeStateButton} type="button" onClick={retry} disabled={retrying}>
            {retrying ? "正在重新加载…" : "重新加载本页"}
          </button>
          <Link className={styles.routeStateButtonSecondary} href="/workspace">返回工作台</Link>
          <Link className={styles.routeStateButtonQuiet} href="/">返回公开首页</Link>
        </div>
        <p className={styles.routeStateHint} role="status">{retrying ? "正在尝试恢复，请稍候。" : "如果问题持续，请从安全入口重新开始。"}</p>
      </section>
    </main>
  );
}
