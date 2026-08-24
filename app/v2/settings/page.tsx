import { SettingsWorkspace } from "./SettingsWorkspace";
import { getAccess } from "../../lib/access";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  if ((await getAccess())?.authType !== "teacher_admin") redirect("/v2");
  return <><section className="v2-hero"><div><p className="v2-eyebrow">SECURITY · MEMBERS · MINI PROGRAM · AI ROUTING</p><h2>系统设置</h2><p>成员、角色、班级授权、小程序绑定、AI 路由和审计记录集中管理。API 密钥只保留在服务器环境中，页面不会读取或回显密钥正文。</p></div></section><SettingsWorkspace/></>;
}
