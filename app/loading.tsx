export default function Loading() {
  return <main className="routeState" aria-busy="true" aria-live="polite">
    <span className="routeStateMark" aria-hidden="true">知</span>
    <div><p>知师研室</p><h1>正在整理教学工作台</h1><span>正在读取课时、题库和待办，请稍候。</span></div>
    <div className="routeStateSkeleton" aria-hidden="true"><i /><i /><i /></div>
  </main>;
}
