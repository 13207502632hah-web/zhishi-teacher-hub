import { notFound } from "next/navigation";
import { EntityDetail } from "./EntityDetail";

const kinds = new Set(["students", "classes", "lessons", "papers", "resources"]);

export default async function DetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!kinds.has(kind) || !/^\d+$/.test(id)) notFound();
  return <EntityDetail kind={kind as "students" | "classes" | "lessons" | "papers" | "resources"} id={Number(id)}/>;
}
