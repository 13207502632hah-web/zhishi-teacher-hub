import { ScheduleWorkspace } from "./ScheduleWorkspace";
import { WeeklyScheduleWorkspace } from "./WeeklyScheduleWorkspace";
import Link from "../../components/HardNavigationLink";
export default async function ScheduleImportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const importing = (await searchParams).view === "imports";
  return <><nav className="lessonViewSwitch" aria-label="课表管理方式"><Link href="/v2/schedule-imports" aria-current={!importing ? "page" : undefined}>每周循环课表</Link><Link href="/v2/schedule-imports?view=imports" aria-current={importing ? "page" : undefined}>从文件导入课表</Link><Link href="/v2/modules/students?view=lessons">全部课时与日历</Link></nav>{importing ? <ScheduleWorkspace /> : <WeeklyScheduleWorkspace />}</>;
}
