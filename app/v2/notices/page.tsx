import { NoticesWorkspace } from "./NoticesWorkspace";

export default function NoticesPage() {
  return <><section className="v2-hero"><div><p className="v2-eyebrow">HOME–SCHOOL NOTICE · READ RECEIPTS</p><h2>家校消息</h2><p>教师先建立通知草稿，主教师确认发布后，学生或家长才能在小程序中查看；系统分别记录打开阅读和“我已知晓”回执。</p></div><div className="v2-hero-actions"><a className="v2-primary" href="#create-notice">新建通知草稿</a><a className="v2-secondary" href="/v2/approvals">查看待确认</a></div></section><NoticesWorkspace/></>;
}
