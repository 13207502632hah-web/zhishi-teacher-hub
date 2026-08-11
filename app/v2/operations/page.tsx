import { OperationsWorkspace } from "./OperationsWorkspace";
import { getAccess } from "../../lib/access";
import { redirect } from "next/navigation";

export default async function OperationsPage() {
  if ((await getAccess())?.role !== "teacher") redirect("/v2");
  return <><section className="v2-hero"><div><p className="v2-eyebrow">ASSESSMENT · CALENDAR · ACADEMIC YEAR</p><h2>评测与教学运营</h2><p>测评、考试项目、答题卡校对、反馈反向解析、日历订阅和学年晋升统一进入 V2。自动识别可以推进任务，最终成绩与晋升仍需教师逐项确认。</p></div></section><OperationsWorkspace/></>;
}
