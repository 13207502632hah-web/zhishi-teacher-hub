"use client";
import Link from "../../components/HardNavigationLink";
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Hit = { id: number; stem: string; questionType?: string; difficulty?: number; grade?: string; knowledgePoints?: string; keywordScore: number; semanticScore: number; rerankScore: number; finalScore: number; matchReasons: string[] };
type Result = { results: Hit[]; phase: string; latencyMs: number; total: number; parsedFilters?: Record<string, unknown>; coverage?: { compared: number; totalCandidates: number; complete: boolean; semanticFallback: boolean; embeddingModel: string } };
type ReviewQuestion = { id: number; stem: string; answer?: string; analysis?: string; knowledgePoints?: string; questionType?: string; parseConfidence?: number; reviewStatus?: string; updatedAt?: string };
type ImportJob = { id: string; state: string; stage: string; progress: number; error?: { message?: string }; result?: { questionSetId?: number; recognized?: number; pairedAnswerCoverage?: { matched: number; total: number } } };

async function encodeImportFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name, type: file.type || "application/octet-stream", base64: btoa(binary) };
}

async function renderPdfPages(file: File, onProgress: (message: string) => void) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return [];
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }), document = await loadingTask.promise;
  if (document.numPages > 40) throw new Error("单份 PDF 最多支持 40 页，请拆分后导入");
  const pages: File[] = [], stem = file.name.replace(/\.pdf$/i, "");
  try {
    for (let number = 1; number <= document.numPages; number++) {
      onProgress(`正在准备 ${file.name} 第 ${number}/${document.numPages} 页…`);
      const page = await document.getPage(number), base = page.getViewport({ scale: 1 }), scale = Math.min(2.2, 1800 / Math.max(1, base.width)), viewport = page.getViewport({ scale }), canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF 页面转换失败")), "image/jpeg", .82));
      if (blob.size > 4 * 1024 * 1024) throw new Error(`PDF 第 ${number} 页转换后超过 4MB，请降低文件清晰度`);
      pages.push(new File([blob], `${stem}-第${number}页.jpg`, { type: "image/jpeg" }));
      page.cleanup(); canvas.width = 1; canvas.height = 1;
    }
  } finally { await loadingTask.destroy(); }
  return pages;
}

async function submitImport(file: File, answerFile: File | undefined, onProgress: (message: string) => void) {
  const [pages, answerPages] = await Promise.all([renderPdfPages(file, onProgress), answerFile ? renderPdfPages(answerFile, onProgress) : Promise.resolve([])]);
  return fetch("/api/v2/questions/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Operation-Id": crypto.randomUUID() },
    body: JSON.stringify({ file: await encodeImportFile(file), answerFile: answerFile ? await encodeImportFile(answerFile) : undefined, pages: await Promise.all(pages.map(encodeImportFile)), answerPages: await Promise.all(answerPages.map(encodeImportFile)) }),
  });
}

export function QuestionSearch() {
  const [query, setQuery] = useState(""), [mode, setMode] = useState("hybrid"), [grade, setGrade] = useState(""), [type, setType] = useState(""), [result, setResult] = useState<Result | null>(null), [semantic, setSemantic] = useState<Result | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(false), [importing, setImporting] = useState(false), [importJob, setImportJob] = useState<ImportJob | null>(null), [selected, setSelected] = useState<number[]>([]), [paperTitle, setPaperTitle] = useState(""), [paperBusy, setPaperBusy] = useState(false), [reviewQuestions, setReviewQuestions] = useState<ReviewQuestion[]>([]), requestRef = useRef(0);
  const loadImport = useCallback(async (id: string) => { const response = await fetch(`/api/v2/questions/imports/${id}`, { cache: "no-store" }), data = await response.json() as { job?: ImportJob; questions?: ReviewQuestion[]; error?: string }; if (!response.ok || !data.job) throw new Error(data.error || "导入任务读取失败"); setImportJob(data.job); if (data.job.state === "completed") { setReviewQuestions(data.questions || []); const coverage = data.job.result?.pairedAnswerCoverage; setNotice(`已识别 ${data.job.result?.recognized || data.questions?.length || 0} 题并自动加入题库${coverage ? `，答案已匹配 ${coverage.matched}/${coverage.total} 题` : ""}（题集 #${data.job.result?.questionSetId || "已创建"}）`); setImporting(false); } else if (["failed", "cancelled"].includes(data.job.state)) { setError(data.job.error?.message || "题库导入任务已暂停"); setImporting(false); } else setNotice(`后台任务 ${data.job.stage} · ${data.job.progress}%：可以关闭页面，任务会继续。`); }, []);
  useEffect(() => { if (!importJob || !["queued", "running"].includes(importJob.state)) return; const timer = window.setInterval(() => void loadImport(importJob.id).catch((reason) => setError(reason instanceof Error ? reason.message : "任务刷新失败")), 2500); return () => window.clearInterval(timer); }, [importJob, loadImport]);
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; setImporting(true); setError(""); setNotice(`正在准备 ${file.name}…`); try { const response = await submitImport(file, undefined, setNotice), data = await response.json() as { job?: ImportJob; error?: string }; if (!response.ok || !data.job) throw new Error(data.error || "导入失败"); setImportJob(data.job); setNotice("原文件已安全保存，AI 拆题正在后台运行；现在关闭页面也不会丢失任务。"); await loadImport(data.job.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "导入失败"); setNotice(""); setImporting(false); } finally { event.target.value = ""; } }
  async function uploadPair(event: ChangeEvent<HTMLInputElement>) { const files = [...(event.target.files || [])]; if (files.length !== 2) { setError("请一次选择题卷和答案卷两个文件"); event.target.value = ""; return; } const answerFile = files.find((file) => /答案|解析/.test(file.name)), questionFile = files.find((file) => file !== answerFile); if (!answerFile || !questionFile) { setError("系统无法区分题卷与答案卷，请确认答案文件名包含“答案”或“解析”"); event.target.value = ""; return; } setImporting(true); setError(""); setNotice(`正在准备 ${questionFile.name} 和 ${answerFile.name}…`); try { const response = await submitImport(questionFile, answerFile, setNotice), data = await response.json() as { job?: ImportJob; error?: string }; if (!response.ok || !data.job) throw new Error(data.error || "成对导入失败"); setImportJob(data.job); setNotice("题卷和答案卷已安全保存，系统正在按原题号拆题并合并答案；关闭页面也不会丢失任务。"); await loadImport(data.job.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "成对导入失败"); setNotice(""); setImporting(false); } finally { event.target.value = ""; } }
  async function search(event?: FormEvent) {
    event?.preventDefault(); const requestId = ++requestRef.current; setLoading(true); setError(""); setResult(null); setSemantic(null);
    const base = { query, mode, pageSize: 20, useCase: "browse", filters: { grade, questionType: type, status: "active" } };
    try {
      const first = await fetch("/api/v2/questions/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, phase: "lexical" }) });
      const lexical = await first.json() as Result & { error?: string }; if (!first.ok) throw new Error(lexical.error || "检索失败"); if (requestId !== requestRef.current) return; setResult(lexical);
      if (mode !== "keyword") { const second = await fetch("/api/v2/questions/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, phase: "semantic" }) }); const enriched = await second.json() as Result & { error?: string }; if (!second.ok) throw new Error(enriched.error || "语义检索失败"); if (requestId === requestRef.current) setSemantic(enriched); }
    } catch (reason) { if (requestId === requestRef.current) setError(reason instanceof Error ? reason.message : "检索失败"); } finally { if (requestId === requestRef.current) setLoading(false); }
  }
  const toggle = (id: number) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  async function createPaper(event: FormEvent) {
    event.preventDefault(); if (!paperTitle.trim() || !selected.length) return; setPaperBusy(true); setError("");
    try { const response = await fetch("/api/v2/papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: paperTitle, type: "练习", grade, status: "draft", questions: selected.map((id, index) => ({ id, score: 5, groupTitle: index < selected.length / 2 ? "基础巩固" : "能力提升", answerSpace: 2 })) }) }), payload = await response.json() as { paper?: { id?: number }; error?: string }; if (!response.ok) throw new Error(payload.error || "试卷草稿创建失败"); setNotice(`试卷草稿已创建（#${payload.paper?.id || "已保存"}），共 ${selected.length} 题、默认每题 5 分。`); setSelected([]); setPaperTitle(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "试卷草稿创建失败"); }
    finally { setPaperBusy(false); }
  }
  const shown = semantic || result;
  return <><section className="v2-hero"><div><p className="v2-eyebrow">HYBRID QUESTION RETRIEVAL</p><h2>说出你想找什么，不必记筛选项。</h2><p>精确编号与结构化筛选优先保证；关键词结果先返回，语义融合和质量重排随后补齐。每一道题都会解释为什么命中。</p></div><div className="v2-hero-actions"><input id="v2-question-file" hidden type="file" accept=".docx,.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.csv" onChange={upload}/><label htmlFor="v2-question-file" className="v2-primary" role="button" tabIndex={0} aria-disabled={importing} onKeyDown={(event) => { if (!importing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); document.getElementById("v2-question-file")?.click(); } }}>{importing ? "正在智能拆题…" : "＋ 导入题目"}</label><input id="v2-question-pair" hidden multiple type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={uploadPair}/><label htmlFor="v2-question-pair" className="v2-secondary" role="button" tabIndex={0} aria-disabled={importing} onKeyDown={(event) => { if (!importing && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); document.getElementById("v2-question-pair")?.click(); } }}>题卷＋答案成对导入</label><Link href="/v2/modules/papers" className="v2-secondary">打开组卷工作台</Link></div></section>
    <section className="v2-card" style={{ marginTop: 17 }}><form className="v2-toolbar" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：八年级法治，公民权利易错选择题，难度适中"/><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="hybrid">混合检索</option><option value="keyword">关键词</option><option value="semantic">语义检索</option></select><input value={grade} onChange={(event) => setGrade(event.target.value)} placeholder="年级"/><input value={type} onChange={(event) => setType(event.target.value)} placeholder="题型"/><button className="v2-primary" disabled={loading}>{loading && !result ? "检索中…" : "开始检索"}</button></form>
      {error && <div className="v2-alert v2-error">{error}</div>}{notice && <div className="v2-alert">{notice}</div>}{result && !semantic && mode !== "keyword" && <div className="v2-alert">关键词首批已返回，正在进行语义比较与模型重排…</div>}
      {reviewQuestions.length > 0 && <section className="v2-import-review"><header className="v2-card-head"><div><h2>已自动入库 · {reviewQuestions.length} 题</h2><p>无需逐题复核；缺失字段继续保留提示，不代表答案已人工验证。</p></div><Link href="/v2/questions?view=library">查看题库</Link></header><div>{reviewQuestions.map((item) => <article key={item.id}><h3>#{item.id} {item.stem}</h3><p>答案：{item.answer || "待补充"} · 知识点：{item.knowledgePoints || "待补充"}</p></article>)}</div></section>}
      {selected.length > 0 && <form className="v2-paper-basket" onSubmit={createPaper}><div><b>选题篮 · {selected.length} 题</b><small>已去重；当前默认每题 5 分，创建后仍是教师草稿</small></div><input value={paperTitle} onChange={(event) => setPaperTitle(event.target.value)} required placeholder="填写试卷名称"/><button className="v2-primary" disabled={paperBusy}>{paperBusy ? "创建中…" : "创建试卷草稿"}</button><button type="button" onClick={() => setSelected([])}>清空</button></form>}
      {shown && <header className="v2-card-head"><div><h2>{shown.total} 个候选结果</h2><p>{semantic ? `语义补齐 ${semantic.latencyMs}ms` : `关键词首屏 ${shown.latencyMs}ms`} · {semantic?.coverage ? `已比较 ${semantic.coverage.compared}/${semantic.coverage.totalCandidates}` : "精确筛选已应用"}</p></div><span className={`v2-status ${semantic ? "completed" : "pending"}`}>{semantic ? "混合重排完成" : "关键词结果"}</span></header>}
      <div className="v2-search-results">{shown?.results.map((item) => <article className={`v2-question ${selected.includes(item.id) ? "selected" : ""}`} key={item.id}><header><span>#{item.id}</span>{item.questionType && <span>{item.questionType}</span>}{item.grade && <span>{item.grade}</span>}{item.difficulty && <span>难度 {item.difficulty}</span>}<em>综合 {Math.round(item.finalScore * 100)}</em></header><h3>{item.stem}</h3><div className="v2-reasons">{item.matchReasons.map((reason) => <span key={reason}>{reason}</span>)}</div><div className="v2-score"><div><b>{Math.round(item.keywordScore * 100)}</b><small>关键词分</small></div><div><b>{Math.round(item.semanticScore * 100)}</b><small>语义分</small></div><div><b>{Math.round(item.rerankScore * 100)}</b><small>模型重排</small></div><div><b>{item.knowledgePoints || "待完善"}</b><small>知识点</small></div></div><button className="v2-question-select" onClick={() => toggle(item.id)}>{selected.includes(item.id) ? "✓ 已加入选题篮" : "＋ 加入选题篮"}</button></article>)}</div>
      {shown && shown.results.length === 0 && <div className="v2-empty"><b>暂时没有合适的题</b>试试去掉一个筛选条件，或换成教学目标来描述。</div>}
    </section></>;
}
