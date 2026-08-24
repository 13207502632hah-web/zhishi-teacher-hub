import { OperationsWorkspace, type OperationsTab } from "./OperationsWorkspace";
import { getAccess } from "../../lib/access";
import { redirect } from "next/navigation";

const tabs: OperationsTab[] = ["assessments", "exams", "recognition", "imports", "calendar", "academic"];

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; year?: string; classId?: string }> }) {
  if ((await getAccess())?.role !== "teacher") redirect("/v2");
  const query = await searchParams, initialTab = tabs.includes(query.tab as OperationsTab) ? query.tab as OperationsTab : "assessments", initialAcademicYear = /^20\d{2}-20\d{2}$/.test(query.year || "") ? query.year : "", initialAssessmentClassId = /^\d+$/.test(query.classId || "") ? query.classId : "";
  return <><section className="v2-hero"><div><p className="v2-eyebrow">ASSESSMENT · CALENDAR · ACADEMIC YEAR</p><h2>评测与教学运营</h2><p>测评、考试项目、答题卡校对、反馈反向解析、日历订阅和学年晋升统一进入 V2。自动识别可以推进任务，最终成绩与晋升仍需教师逐项确认。</p></div></section><OperationsWorkspace initialTab={initialTab} initialAcademicYear={initialAcademicYear} initialAssessmentClassId={initialAssessmentClassId}/></>;
}
