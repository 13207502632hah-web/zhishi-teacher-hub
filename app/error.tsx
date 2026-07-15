"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="routeState" role="alert">
    <span className="routeStateMark" aria-hidden="true">知</span>
    <div><p>数据没有丢失</p><h1>这个页面暂时没有加载成功</h1><span>可能是网络波动或服务暂时繁忙。系统不会因为本次失败自动重复提交或修改教学记录。</span></div>
    <div className="routeStateActions"><button className="primaryButton" onClick={reset}>重新加载本页</button><button className="secondaryButton" onClick={() => window.location.assign("/workspace")}>返回工作台</button></div>
  </main>;
}
