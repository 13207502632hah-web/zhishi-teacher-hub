import type { ReactNode } from "react";
import Link from "@/app/components/HardNavigationLink";
import { AppShell } from "@/app/components/AppShell";
import styles from "./legal.module.css";

type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

export function LegalPage({
  title,
  subtitle,
  updatedAt,
  introduction,
  sections,
}: {
  title: string;
  subtitle: string;
  updatedAt: string;
  introduction: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className={styles.layout}>
        <aside className={styles.directory} aria-label={`${title}目录`}>
          <p>页面目录</p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
            ))}
          </ol>
          <div className={styles.related}>
            <span>相关页面</span>
            <Link href="/privacy">隐私政策</Link>
            <Link href="/terms">用户协议</Link>
            <Link href="/account-deletion">账号删除</Link>
            <Link href="/support">帮助支持</Link>
          </div>
        </aside>

        <article className={styles.article}>
          <header>
            <span>最近更新：{updatedAt}</span>
            <div className={styles.introduction}>{introduction}</div>
          </header>
          {sections.map((section, index) => (
            <section id={section.id} key={section.id}>
              <p className={styles.number}>{String(index + 1).padStart(2, "0")}</p>
              <h2>{section.title}</h2>
              <div className={styles.content}>{section.content}</div>
            </section>
          ))}
          <footer>
            <p>如对本页面内容有疑问，请通过平时与授课教师联系的渠道提出。</p>
            <Link href="/support">前往帮助支持</Link>
          </footer>
        </article>
      </div>
    </AppShell>
  );
}
