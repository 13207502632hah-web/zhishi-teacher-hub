import Link from "../../components/HardNavigationLink";
import { DictationWorkspace } from "./DictationWorkspace";

export default function DictationsPage() {
  return <>
    <section className="v2-hero"><div><p className="v2-eyebrow">DICTATION & FOLLOW READING · SHARED DATA</p><h2>跟读与听写</h2><p>教师在网站建立内容和示范音频，学生或家长在小程序录音、上传并提交；批改、订正和学情证据继续复用作业闭环。</p></div><div className="v2-hero-actions"><Link className="v2-primary" href="/v2/assistant">✦ 让 AI 准备内容</Link><Link className="v2-secondary" href="/v2/modules/assignments">打开批改队列</Link></div></section>
    <DictationWorkspace/>
  </>;
}
