import Link from "../../components/HardNavigationLink";
import { QuestionLibraryWorkspace } from "./QuestionLibraryWorkspace";
import { QuestionSearch } from "./QuestionSearch";

export default async function QuestionsV2Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = params.view === "library" ? "library" : "search";
  return <>
    <nav className="v2-section-tabs" aria-label="智能题库工作区">
      <Link href="/v2/questions" className={view === "search" ? "active" : ""} aria-current={view === "search" ? "page" : undefined}>智能检索与导入</Link>
      <Link href="/v2/questions?view=library" className={view === "library" ? "active" : ""} aria-current={view === "library" ? "page" : undefined}>完整题库管理</Link>
      <Link href="/v2/approvals">待确认中心</Link>
      <Link href="/v2/modules/papers">组卷工作台</Link>
    </nav>
    {view === "library" ? <QuestionLibraryWorkspace /> : <QuestionSearch />}
  </>;
}
