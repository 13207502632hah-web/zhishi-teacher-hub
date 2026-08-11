import { AssistantWorkspace } from "./AssistantWorkspace";
import { Suspense } from "react";
export default function AssistantPage() { return <Suspense fallback={<section className="v2-card v2-loading">正在打开智能助手…</section>}><AssistantWorkspace /></Suspense>; }
