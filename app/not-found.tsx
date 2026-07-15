import Link from "next/link";

export default function NotFound() {
  return <main className="routeState">
    <span className="routeStateMark" aria-hidden="true">知</span>
    <div><p>404</p><h1>没有找到这个页面</h1><span>链接可能已经调整，原有教学数据不会受到影响。</span></div>
    <div className="routeStateActions"><Link className="primaryButton" href="/workspace">返回工作台</Link><Link className="secondaryButton" href="/questions">打开题库</Link></div>
  </main>;
}
