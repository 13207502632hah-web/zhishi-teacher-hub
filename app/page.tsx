"use client";

import Link from "@/app/components/HardNavigationLink";
import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { BRAND_EDITION, BRAND_NAME, BRAND_SUBJECT, PUBLIC_TEACHER_SPACE } from "./lib/brand";
import { HttpError, requestJson } from "./lib/http-client";

const teachingLoop = [
  { number: "01", label: "备课", note: "目标、重难点与题目" },
  { number: "02", label: "上课", note: "课堂过程与学生表现" },
  { number: "03", label: "作业", note: "任务、提交与批改" },
  { number: "04", label: "反馈", note: "教师确认后再发送" },
  { number: "05", label: "结算", note: "课时依据清晰可查" },
];

type PublicResourceItem = Record<string, unknown> & { id: number };
type PublicResourcePreview = { resources: PublicResourceItem[]; summary?: { publicCount?: number; popularTags?: string[] } };

export default function PublicHome() {
  const [preview, setPreview] = useState<PublicResourcePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<PublicResourcePreview>("/api/v2/resources?scope=public&limit=3", { signal: controller.signal })
      .then((payload) => setPreview(payload && Array.isArray(payload.resources) ? payload : null))
      .catch((error) => {
        if (!controller.signal.aborted && !(error instanceof HttpError)) setPreviewError(true);
      });
    return () => controller.abort();
  }, []);

  return <AppShell title={BRAND_NAME} publicLanding>
    <section className="publicHomeHero">
      <div className="publicHomeHero__copy">
        <p className="publicHomeEyebrow"><span>{PUBLIC_TEACHER_SPACE}</span><i aria-hidden="true" /></p>
        <h1>把一节课，做成<br />可积累的教学资产。</h1>
        <p className="publicHomeLead">从备课、上课到作业、反馈与结算，把真实教学过程安静地收进一个工作台。数据归教师管理，重要结果始终由教师确认。</p>
        <div className="publicHomeActions">
          <Link className="publicHomePrimary" href="/teacher-login?return_to=%2Fv2">教师登录 <span aria-hidden="true">→</span></Link>
          <Link className="publicHomeSecondary" href="/resources">浏览公开资源</Link>
        </div>
        <ul className="publicHomeTrust" aria-label="工作台原则">
          <li>私人数据不公开</li>
          <li>教师确认后生效</li>
          <li>初高中{BRAND_SUBJECT}教学</li>
        </ul>
      </div>

      <div className="publicHomeDesk" aria-label="一节课的教学闭环示意">
        <div className="publicHomeDesk__folio">{BRAND_NAME} · {BRAND_EDITION}</div>
        <div className="publicHomeDesk__heading">
          <div><span>今日课题</span><strong>理解权利与义务</strong></div>
          <span className="publicHomeDesk__sample">示例课时<br />教学手记</span>
        </div>
        <ol className="publicHomeLoop">
          {teachingLoop.map((step, index) => <li key={step.label}>
            <span>{step.number}</span>
            <div><b>{step.label}</b><small>{step.note}</small></div>
            {index < teachingLoop.length - 1 && <i aria-hidden="true" />}
          </li>)}
        </ol>
        <div className="publicHomeDesk__note"><span aria-hidden="true">批</span><p>系统可以整理草稿，教学判断由教师完成。</p></div>
      </div>
    </section>

    <section className="publicHomePrinciples" aria-labelledby="public-principles-title">
      <div className="publicHomeSectionHead">
        <p>不是再多一个工具</p>
        <h2 id="public-principles-title">让日常教学留下可复用的脉络</h2>
      </div>
      <div className="publicHomePrincipleGrid">
        <article><span>一</span><h3>从今天的课开始</h3><p>先处理临近课程和真实待办，不要求一次补齐所有历史资料。</p></article>
        <article><span>二</span><h3>题目有出处，反馈有依据</h3><p>保留题目原文和校对状态；生成内容先作为草稿，由教师决定是否采用。</p></article>
        <article><span>三</span><h3>学生信息保持私密</h3><p>公开资源与班级、学生、评价严格分开，权限在服务端再次核验。</p></article>
      </div>
    </section>

    <section className="publicHomeResource" aria-labelledby="public-resource-title">
      <div className="publicHomeResourceIntro">
        <p>公开阅览室</p>
        <h2 id="public-resource-title">想先看看？从教学资源开始。</h2>
        <span>公开资源无需登录；课时、学生、反馈和结算只在教师工作台中显示。这里只展示教师主动公开且不含私人信息的资源。</span>
        {preview && !previewError && <p className="publicHomeResourceMeta">当前公开 {preview.summary?.publicCount ?? preview.resources.length} 份 · 热门标签 {preview.summary?.popularTags?.slice(0, 3).join(" / ") || "暂无"}</p>}
      </div>
      <div className="publicHomeResourcePreview">
        {previewError ? <p className="publicHomeResourceEmpty">资源暂时无法读取；稍后可在公开资源中心直接检索。</p> : preview?.resources?.length ? preview.resources.slice(0, 3).map((item) => <Link className="publicHomeResourceCard" href={`/resources/${item.id}`} key={item.id}><span>{String(item.type || "资源")}</span><b>{String(item.title || "未命名资源")}</b><small>{String(item.tags || "未设置标签")}</small></Link>) : <p className="publicHomeResourceEmpty">还没有公开资源；教师发布不含私人信息的资源后，访客会在这里看到最近内容。</p>}
        <Link className="publicHomeResourceLink" href="/resources">进入公开资源中心 <span aria-hidden="true">↗</span></Link>
      </div>
    </section>
  </AppShell>;
}
