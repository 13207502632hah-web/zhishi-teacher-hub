import styles from "./route-states.module.css";
import { BRAND_MARK, BRAND_NAME } from "./lib/brand";

export default function Loading() {
  return (
    <main className={styles.routeState} aria-busy="true" aria-live="polite">
      <section className={styles.routeStatePanel} aria-label="正在加载">
        <span className={styles.routeStateMark} aria-hidden="true">{BRAND_MARK}</span>
        <div className={styles.routeStateCopy}>
          <p className={styles.routeStateEyebrow}>{BRAND_NAME} / 请稍候</p>
          <h1 className={styles.routeStateTitle}>正在整理教学工作台</h1>
          <p className={styles.routeStateMessage}>正在读取课时、题库和待办。页面内容准备好后会显示在这里。</p>
        </div>
        <div className={styles.routeStateSkeleton} aria-hidden="true">
          <span className={styles.routeStateSkeletonBar} />
          <span className={styles.routeStateSkeletonBar} />
          <span className={`${styles.routeStateSkeletonBar} ${styles.routeStateSkeletonBarShort}`} />
        </div>
        <p className={styles.routeStateHint} role="status">正在加载，不会自动提交或修改教学记录。</p>
      </section>
    </main>
  );
}
