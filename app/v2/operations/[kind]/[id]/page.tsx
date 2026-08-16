import { notFound } from "next/navigation";
import { OperationDetail } from "./OperationDetail";

const kinds = new Set(["assessments", "exams", "recognition", "imports"]);

export default async function OperationDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!kinds.has(kind) || !/^\d+$/.test(id)) notFound();
  return <OperationDetail kind={kind as "assessments" | "exams" | "recognition" | "imports"} id={Number(id)}/>;
}
