import Link from "../components/HardNavigationLink";
import { env } from "cloudflare:workers";

async function count(sql: string, ...bindings: unknown[]) { try { return Number((await env.DB.prepare(sql).bind(...bindings).first<{ total: number }>())?.total || 0); } catch { return 0; } }

export default async function V2Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [lessons, students, questions, pending, running, submissions] = await Promise.all([
    count("SELECT count(*) AS total FROM lessons WHERE date=? AND status!='cancelled'", today), count("SELECT count(*) AS total FROM students WHERE status='active'"), count("SELECT count(*) AS total FROM questions WHERE status='active'"), count("SELECT count(*) AS total FROM v2_approvals WHERE state='pending'"), count("SELECT count(*) AS total FROM v2_jobs WHERE state IN ('queued','running','waiting_review','partial')"), count("SELECT count(*) AS total FROM assignment_submissions WHERE status IN ('submitted','pending_review')"),
  ]);
  return <>
    <section className="v2-hero"><div><p className="v2-eyebrow">DAILY TEACHING COCKPIT · {today}</p><h2>今天先把最影响教学的事处理掉。</h2><p>课表、题库、作业与学情证据已经放在同一条工作流里。AI 可以识别、检索、分析和起草；正式写入仍由你确认。</p></div><div className="v2-hero-actions"><Link href="/v2/assistant?preset=daily" className="v2-primary">✦ 生成今日建议</Link><Link href="/v2/approvals" className="v2-secondary">查看 {pending} 项待确认</Link></div></section>
    <section className="v2-metric-grid"><article className="v2-metric"><span>今日课时</span><b>{lessons}</b><small>按实际课表计算</small></article><article className="v2-metric"><span>在读学生</span><b>{students}</b><small>仅统计活跃档案</small></article><article className="v2-metric"><span>可用题目</span><b>{questions}</b><small>支持混合检索</small></article><article className="v2-metric"><span>待批提交</span><b>{submissions}</b><small>学生端同步而来</small></article><article className="v2-metric"><span>后台任务</span><b>{running}</b><small>关闭页面仍可继续</small></article></section>
    <div className="v2-grid">
      <section className="v2-card"><header className="v2-card-head"><div><h2>现在值得处理</h2><p>按教学影响与紧迫程度排列</p></div><Link href="/v2/assistant">让 AI 重新分析</Link></header><div className="v2-action-list">
        <Link href="/v2/approvals"><i>✓</i><span><b>{pending ? `${pending} 项建议等待你的确认` : "待确认中心已清空"}</b><small>课表调整、题库修改、作业发布和反馈发送统一在此核对</small></span><em>进入 →</em></Link>
        <Link href="/v2/schedule-imports"><i>日</i><span><b>智能课表：导入或核对新课表</b><small>自动识别日期、节次、学生、费用，并在写入前检查冲突</small></span><em>开始 →</em></Link>
        <Link href="/v2/questions"><i>题</i><span><b>智能题库：用一句话找出合适的题</b><small>关键词结果先出现，语义重排随后渐进补齐</small></span><em>检索 →</em></Link>
      </div></section>
      <section className="v2-card"><header className="v2-card-head"><div><h2>智能化边界</h2><p>自动化更强，责任链依旧清楚</p></div></header><div className="v2-action-list"><article><i>隐</i><span><b>默认匿名化</b><small>姓名、电话、邮箱等身份字段发往外部模型前自动替换</small></span><em className="v2-status completed">已启用</em></article><article><i>路</i><span><b>多模型路由</b><small>按速度、推理、视觉和重排能力自动选择并故障切换</small></span><em className="v2-status completed">质量优先</em></article><article><i>审</i><span><b>正式动作需确认</b><small>所有建议保留模型、提示词版本、置信度、依据和采用结果</small></span><em className="v2-status pending">受控</em></article></div></section>
      <section className="v2-card wide"><header className="v2-card-head"><div><h2>完整教学工作流</h2><p>V2 已按工作任务重新分组，底层契约与小程序共用</p></div></header><div className="v2-module-grid"><Link className="v2-module" href="/v2/modules/students"><span>人</span><h3>学生与班级</h3><p>授权、档案、学年晋升与班级成员在同一个上下文管理。</p><small>进入工作区 →</small></Link><Link className="v2-module" href="/v2/modules/assignments"><span>业</span><h3>作业教学闭环</h3><p>发布、提交、批改、订正、错题和反馈形成可追溯证据链。</p><small>进入工作区 →</small></Link><Link className="v2-module" href="/v2/modules/learning"><span>析</span><h3>学情与反馈</h3><p>只基于真实课时、作业与测评证据输出结论和置信度。</p><small>进入工作区 →</small></Link></div></section>
    </div>
  </>;
}
