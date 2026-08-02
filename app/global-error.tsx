"use client";

import Link from "@/app/components/HardNavigationLink";
import { useState } from "react";
import styles from "./route-states.module.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    if (typeof reset === "function") reset();
    else window.location.reload();
  };

  return (
    <html lang="zh-CN">
      <body>
        <main className={styles.routeState} role="alert" aria-live="assertive">
          <section className={styles.routeStatePanel}>
            <span className={styles.routeStateMark} aria-hidden="true">知</span>
            <div className={styles.routeStateCopy}>
              <p className={styles.routeStateEyebrow}>知师研室 / 需要重新开始</p>
              <h1 className={styles.routeStateTitle}>页面暂时无法显示</h1>
              <p className={styles.routeStateMessage}>基础页面加载没有完成。请重试，或从安全入口重新开始。</p>
            </div>
            <div className={styles.routeStateActions}>
              <button className={styles.routeStateButton} type="button" onClick={retry} disabled={retrying}>
                {retrying ? "正在重新加载…" : "重试"}
              </button>
              <Link className={styles.routeStateButtonSecondary} href="/workspace">返回工作台</Link>
              <Link className={styles.routeStateButtonQuiet} href="/">返回公开首页</Link>
            </div>
            <p className={styles.routeStateHint} role="status">不会显示内部错误信息，也不会自动提交或修改教学记录。</p>
          </section>
        </main>
      </body>
    </html>
  );
}
