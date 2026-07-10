import Link from "next/link";
import { AppShell, EmptyState } from "./components/AppShell";

const metrics = [
  ["本周课时", "0", "完成课时后自动统计"], ["已完成反馈", "0", "确认反馈后自动统计"],
  ["学生出勤率", "—", "数据不足"], ["作业完成率", "—", "数据不足"],
];

export default function Dashboard() {
  return <AppShell title="工作台" subtitle="今天也从一节认真准备的课开始。" actions={<Link href="/lessons?new=1" className="primaryButton">＋ 新建课时</Link>}>
    <div className="noticeStrip"><b>开始建立您的真实教学记录</b><span>目前没有学生或课时数据。录入后，工作台会自动生成待办与统计。</span><Link href="/classes">先创建班级 →</Link></div>
    <div className="metricGrid">{metrics.map(([label, value, note]) => <article className="metricCard" key={label}><span>{label}</span><b>{value}</b><small>{note}</small></article>)}</div>
    <div className="dashboardGrid">
      <section className="panel span2"><div className="panelTitle"><div><p>今日课程</p><h2>课程安排</h2></div><Link href="/lessons">查看全部</Link></div><EmptyState title="今天还没有课程" description="新建课时并选择今天的日期后，会在这里显示时间、班级、课题、地点和备课状态。" action={<Link className="secondaryButton" href="/lessons?new=1">新建今日课时</Link>} /></section>
      <section className="panel"><div className="panelTitle"><div><p>行动清单</p><h2>待办事项</h2></div></div><ul className="todoList"><li><span>待补课时记录</span><b>0</b></li><li><span>待发送反馈</span><b>0</b></li><li><span>待批改作业</span><b>0</b></li><li><span>待跟进学生</span><b>0</b></li></ul></section>
      <section className="panel"><div className="panelTitle"><div><p>安全提醒</p><h2>重点关注学生</h2></div></div><EmptyState title="暂无需关注项" description="风险标签必须由教师确认；系统不会自动给学生作评价性结论。" /></section>
      <section className="panel span2"><div className="panelTitle"><div><p>常用操作</p><h2>快捷入口</h2></div></div><div className="quickGrid"><Link href="/lessons?new=1"><b>＋</b><span>新建课时</span></Link><Link href="/students?new=1"><b>人</b><span>录入学生</span></Link><Link href="/questions?new=1"><b>题</b><span>添加题目</span></Link><Link href="/feedback?new=1"><b>信</b><span>新建反馈</span></Link><Link href="/reflections?new=1"><b>思</b><span>新建反思</span></Link></div></section>
      <section className="panel"><div className="panelTitle"><div><p>近期动态</p><h2>教学反思与题库</h2></div></div><EmptyState title="还没有动态" description="记录反思或导入题目后，这里会显示最近更新。" /></section>
    </div>
  </AppShell>;
}
