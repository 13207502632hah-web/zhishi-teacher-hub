import { notFound } from "next/navigation";
import { EntityDetail } from "./EntityDetail";
import { StudentDetailWorkspace } from "./StudentDetailWorkspace";
import { ClassDetailWorkspace } from "./ClassDetailWorkspace";
import { LessonDetailWorkspace } from "./LessonDetailWorkspace";
import { PaperDetailWorkspace } from "./PaperDetailWorkspace";

const kinds = new Set(["students", "classes", "lessons", "papers", "resources"]);

export default async function DetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!kinds.has(kind) || !/^\d+$/.test(id)) notFound();
  if (kind === "students") return <StudentDetailWorkspace studentId={Number(id)}/>;
  if (kind === "classes") return <ClassDetailWorkspace classId={Number(id)}/>;
  if (kind === "lessons") return <LessonDetailWorkspace lessonId={Number(id)}/>;
  if (kind === "papers") return <PaperDetailWorkspace paperId={Number(id)}/>;
  return <EntityDetail id={Number(id)}/>;
}
