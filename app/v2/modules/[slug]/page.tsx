import Link from "../../../components/HardNavigationLink";
import { notFound } from "next/navigation";
import { ModuleWorkspace } from "./ModuleWorkspace";
import { getAccess } from "../../../lib/access";
import { redirect } from "next/navigation";

const modules = {
  students: { title: "学生、班级与课时", intro: "从教师工作任务出发管理档案、班级成员和真实课时。" },
  papers: { title: "组卷工作台", intro: "围绕课时目标、学生薄弱点、难度梯度与总分约束组织试卷。" },
  assignments: { title: "作业与批改", intro: "让草稿、发布、提交、批改、订正与反馈形成连续教学证据。" },
  learning: { title: "学情与反馈", intro: "每个判断都附真实数据来源、证据范围和置信度。" },
  resources: { title: "资源中心", intro: "教学资料、公开资源与私有附件统一分类并通过鉴权读取。" },
  finance: { title: "财务核对", intro: "费用跟随真实课时，异常和变更保留完整审核记录。" },
};

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; q?: string; lessonId?: string; studentId?: string; classId?: string; status?: string; submissionStatus?: string; type?: string; new?: string; ai?: string }> }) {
  const slug = (await params).slug as keyof typeof modules, item = modules[slug]; if (!item) notFound();
  if (slug === "finance" && (await getAccess())?.role !== "teacher") redirect("/v2");
  const query = await searchParams;
  return <><section className="v2-hero"><div><p className="v2-eyebrow">UNIFIED TEACHING WORKSPACE · V2 NATIVE</p><h2>{item.title}</h2><p>{item.intro} 当前页面直接读取版本化接口，不再跳回旧站；跨端共享数据，敏感正式动作继续进入待确认中心。</p></div><div className="v2-hero-actions"><Link className="v2-primary" href="/v2/assistant">✦ 让 AI 准备草稿</Link><Link className="v2-secondary" href="/v2/approvals">查看待确认</Link></div></section><ModuleWorkspace slug={slug} initialView={query.view} initialQuery={query.q} initialLessonId={query.lessonId} initialStudentId={query.studentId} initialClassId={query.classId} initialStatus={query.status} initialSubmissionStatus={query.submissionStatus} initialType={query.type} initialNew={query.new === "1"} initialAi={query.ai === "1"}/></>;
}
