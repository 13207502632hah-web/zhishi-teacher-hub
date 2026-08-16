import { getAccess } from "../../lib/access";
import { AccountWorkspace } from "./AccountWorkspace";

export default async function AccountPage() {
  const access = await getAccess();
  return <><section className="v2-hero"><div><p className="v2-eyebrow">ACCOUNT · SESSION · SECURITY</p><h2>账号与安全</h2><p>查看当前登录身份、更新独立助教密码或安全退出。修改密码后，其他设备上的旧会话会立即失效。</p></div></section><AccountWorkspace user={{ name: access?.name || "", email: access?.email || "", role: access?.role || "teacher", authType: access?.authType || "teacher_admin" }}/></>;
}
