import { ToolboxWorkspace } from "./ToolboxWorkspace";

export default function ToolboxPage() {
  return <><section className="v2-hero"><div><p className="v2-eyebrow">CLASSROOM UTILITIES · NO DUPLICATE DATA</p><h2>课堂工具箱</h2><p>点兵点将直接读取当前班级成员，口算检测在本机即时生成和判分；课件与教案继续使用已有资料和智能备课入口。</p></div><div className="v2-hero-actions"><a className="v2-primary" href="#roll-call">开始点名</a><a className="v2-secondary" href="#arithmetic">生成口算</a></div></section><ToolboxWorkspace/></>;
}
