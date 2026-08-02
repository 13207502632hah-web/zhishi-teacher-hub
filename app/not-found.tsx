"use client";

import Link from "@/app/components/HardNavigationLink";
import { usePathname } from "next/navigation";
import styles from "./route-states.module.css";

export default function NotFound() {
  const pathname = usePathname();
  const publicContext = pathname === "/" || pathname === "/resources" || pathname?.startsWith("/resources/") || pathname === "/teacher-login";

  return (
    <main className={styles.routeState}>
      <section className={styles.routeStatePanel}>
        <span className={styles.routeStateMark} aria-hidden="true">知</span>
        <div className={styles.routeStateCopy}>
          <p className={styles.routeStateEyebrow}>{publicContext ? "知师研室 / 公开入口" : "知师研室 / 工作台入口"}</p>
          <h1 className={styles.routeStateTitle}>没有找到这个页面</h1>
          <p className={styles.routeStateMessage}>
            {publicContext ? "链接可能已经调整。你可以回到公开首页，或先浏览公开资源。" : "这个工作台页面可能已经调整。教学数据不会因为找不到页面而改变。"}
          </p>
        </div>
        <div className={styles.routeStateActions}>
          {publicContext ? (
            <>
              <Link className={styles.routeStateButton} href="/">回到公开首页</Link>
              <Link className={styles.routeStateButtonSecondary} href="/resources">浏览公开资源</Link>
              <Link className={styles.routeStateButtonQuiet} href="/teacher-login">教师登录</Link>
            </>
          ) : (
            <>
              <Link className={styles.routeStateButton} href="/workspace">返回工作台</Link>
              <Link className={styles.routeStateButtonSecondary} href="/">返回公开首页</Link>
              <Link className={styles.routeStateButtonQuiet} href="/resources">浏览公开资源</Link>
            </>
          )}
        </div>
        <p className={styles.routeStateHint}>页面不会显示受限路由、请求内容或内部错误信息。</p>
      </section>
    </main>
  );
}
