"use client";

import Link from "../../components/HardNavigationLink";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Lesson = { id: number; date: string; startTime?: string; courseName: string; topic?: string; classId?: number; className?: string };
type RecordItem = { id: string; kind: string; title: string; content: string; occurredAt: string; lessonId: number | null; classId: number | null; studentId: number | null; status: string; audience: string; source: string; version: number; updatedAt: string };
type Draft = { id: string; operationId: string; baseVersion: number; kind: string; title: string; content: string; occurredAt: string; lessonId: number | null; classId: number | null; source: "web" };

const OUTBOX = "zhishi-mobile-outbox-v1";
const CONFLICTS = "zhishi-mobile-conflicts-v1";
const DRAFT = "zhishi-mobile-draft-v1";
const labels: Record<string, string> = { lesson_note: "课堂记录", homework: "作业想法", feedback_draft: "反馈草稿", reflection: "教学反思", idea: "临时想法" };

function readItems(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value as Draft[] : [];
  } catch { return []; }
}

function writeItems(key: string, items: Draft[]) { localStorage.setItem(key, JSON.stringify(items)); }
function retryable(status: number) { return status === 408 || status === 429 || status >= 500; }

export function RecordWorkspace() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [conflicts, setConflicts] = useState<Draft[]>([]);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [kind, setKind] = useState("lesson_note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [lessonId, setLessonId] = useState(0);
  const [editingId, setEditingId] = useState("");
  const [editingVersion, setEditingVersion] = useState(0);
  const [editingOccurredAt, setEditingOccurredAt] = useState("");
  const selectedLesson = useMemo(() => lessons.find((item) => item.id === lessonId), [lessonId, lessons]);

  const load = useCallback(async () => {
    const [recordResponse, lessonResponse] = await Promise.all([
      fetch("/api/v2/mobile/records", { cache: "no-store" }),
      fetch("/api/lessons?from=" + new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10), { cache: "no-store" }),
    ]);
    if (recordResponse.ok) setRecords(((await recordResponse.json()) as { records: RecordItem[] }).records || []);
    if (lessonResponse.ok) setLessons(((await lessonResponse.json()) as { lessons: Lesson[] }).lessons?.slice(0, 40) || []);
  }, []);

  const keepConflict = useCallback((draft: Draft) => {
    setConflicts((current) => {
      const next = [...current.filter((item) => item.id !== draft.id), draft];
      writeItems(CONFLICTS, next);
      return next;
    });
  }, []);

  const flush = useCallback(async () => {
    const items = readItems(OUTBOX);
    if (!items.length || !navigator.onLine) { setPending(items.length); return; }
    const left: Draft[] = [];
    let synced = 0;
    let conflicted = 0;
    for (const item of items) {
      try {
        const response = await fetch("/api/v2/mobile/records", { method: "POST", headers: { "Content-Type": "application/json", "X-Operation-Id": item.operationId }, body: JSON.stringify(item) });
        if (response.ok) synced += 1;
        else if (retryable(response.status)) left.push(item);
        else { keepConflict(item); conflicted += 1; }
      } catch { left.push(item); }
    }
    writeItems(OUTBOX, left);
    setPending(left.length);
    if (conflicted) setError(`${conflicted} 条离线修改与服务器版本冲突，本机内容已保留`);
    if (synced) { setNotice(`已自动同步 ${synced} 条离线记录`); await load(); }
  }, [keepConflict, load]);

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT);
    if (saved) {
      try {
        const draft = JSON.parse(saved) as Partial<Draft>;
        setKind(draft.kind || "lesson_note"); setTitle(draft.title || ""); setContent(draft.content || "");
        setLessonId(Number(draft.lessonId || 0)); setEditingId(draft.baseVersion ? draft.id || "" : "");
        setEditingVersion(Number(draft.baseVersion || 0)); setEditingOccurredAt(draft.occurredAt || "");
      } catch {}
    }
    const becameOnline = () => { setOnline(true); flush(); };
    const becameOffline = () => setOnline(false);
    setOnline(navigator.onLine); setPending(readItems(OUTBOX).length); setConflicts(readItems(CONFLICTS));
    load().catch(() => setError("读取记录失败，请稍后重试")); flush();
    window.addEventListener("online", becameOnline); window.addEventListener("offline", becameOffline);
    return () => { window.removeEventListener("online", becameOnline); window.removeEventListener("offline", becameOffline); };
  }, [flush, load]);

  useEffect(() => {
    localStorage.setItem(DRAFT, JSON.stringify({ id: editingId, baseVersion: editingVersion, occurredAt: editingOccurredAt, kind, title, content, lessonId }));
  }, [content, editingId, editingOccurredAt, editingVersion, kind, lessonId, title]);

  function resetEditor() {
    setKind("lesson_note"); setTitle(""); setContent(""); setLessonId(0); setEditingId(""); setEditingVersion(0); setEditingOccurredAt("");
    localStorage.removeItem(DRAFT);
  }

  function edit(item: RecordItem) {
    setKind(item.kind); setTitle(item.title); setContent(item.content); setLessonId(item.lessonId || 0);
    setEditingId(item.id); setEditingVersion(item.version); setEditingOccurredAt(item.occurredAt);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadConflictAsCopy(draft: Draft) {
    setKind(draft.kind); setTitle(draft.title); setContent(draft.content); setLessonId(draft.lessonId || 0);
    setEditingId(""); setEditingVersion(0); setEditingOccurredAt(""); discardConflict(draft);
    setNotice("冲突内容已载入；保存后会成为一条新记录"); window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function discardConflict(draft: Draft) {
    setConflicts((current) => { const next = current.filter((item) => item.id !== draft.id); writeItems(CONFLICTS, next); return next; });
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); if (!title.trim() || !content.trim() || busy) return;
    const id = editingId || crypto.randomUUID();
    const item: Draft = { id, operationId: `web-${crypto.randomUUID()}`, baseVersion: editingVersion, kind, title: title.trim(), content: content.trim(), occurredAt: editingOccurredAt || new Date().toISOString(), lessonId: lessonId || null, classId: selectedLesson?.classId || null, source: "web" };
    setBusy(true); setError("");
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const response = await fetch("/api/v2/mobile/records", { method: "POST", headers: { "Content-Type": "application/json", "X-Operation-Id": item.operationId }, body: JSON.stringify(item) });
      const data = await response.json() as { error?: string };
      if (response.status === 409) { keepConflict(item); setError("另一台设备已修改这条记录；本机版本已保留，可另存为新记录"); await load(); resetEditor(); return; }
      if (!response.ok) { setError(data.error || "保存失败"); return; }
      setNotice(editingVersion ? "修改已同步到所有设备" : "已保存到工作室，网页、iOS 与同步接口均可读取");
      resetEditor(); await load();
    } catch {
      const items = readItems(OUTBOX);
      const next = [...items.filter((queued) => queued.id !== item.id), item];
      writeItems(OUTBOX, next); setPending(next.length); setNotice("网络不稳定，已保存到本机，联网后自动同步"); resetEditor();
    } finally { setBusy(false); }
  }

  async function remove(item: RecordItem) {
    if (item.status === "confirmed" || busy) return; setBusy(true); setError("");
    const operationId = `web-delete-${crypto.randomUUID()}`;
    const response = await fetch(`/api/v2/mobile/records/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Operation-Id": operationId }, body: JSON.stringify({ baseVersion: item.version, operationId }) });
    setBusy(false); if (response.ok) { setNotice("草稿已删除"); await load(); } else { setError(response.status === 409 ? "删除前记录已在其他设备更新，请刷新后重试" : ((await response.json()) as { error?: string }).error || "删除失败"); if (response.status === 409) await load(); }
  }

  async function share(item: RecordItem) {
    if (busy) return; setBusy(true); setError("");
    const response = await fetch(`/api/v2/mobile/records/${item.id}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audience: "both" }) });
    setBusy(false); if (response.ok) setNotice("已进入待确认中心；确认后学生和家长小程序才会看到"); else setError(((await response.json()) as { error?: string }).error || "提交确认失败");
  }

  return <>
    <section className="v2-hero"><div><p className="v2-eyebrow">MOBILE QUICK CAPTURE</p><h2>手机打开，三十秒记下课堂现场。</h2><p>草稿先保存在教师工作区；弱网时留在本机，恢复联网后自动同步。只有经过待确认中心的内容才会出现在学生和家长小程序。</p></div><div className="v2-hero-actions"><Link href="/install" className="v2-primary">添加到手机主屏幕</Link><button className="v2-secondary" onClick={flush}>同步离线记录 {pending ? `(${pending})` : ""}</button></div></section>
    <div className="v2-record-layout">
      <section className="v2-card"><header className="v2-card-head"><div><h2>{editingVersion ? "编辑记录" : "新建记录"}</h2><p>输入内容会在本机暂存，关闭页面后仍可恢复</p></div><span className={`v2-status ${pending ? "warning" : "completed"}`}>{pending ? `${pending} 条待同步` : online ? "已同步" : "离线"}</span></header>
        {notice && <div className="v2-alert">{notice}</div>}{error && <div className="v2-alert v2-error">{error}</div>}
        <form className="v2-form" onSubmit={submit}><label>记录类型<select value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>关联近期课时（可选）<select value={lessonId} onChange={(event) => setLessonId(Number(event.target.value))}><option value={0}>暂不关联</option>{lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{lesson.date} {lesson.startTime} · {lesson.className || lesson.courseName} {lesson.topic || ""}</option>)}</select></label><label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="一句话标记这条记录" required /></label><label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={20000} placeholder="学生表现、课堂进度、作业、反馈或下次调整…" required /></label><div className="v2-hero-actions"><button className="v2-primary" disabled={busy}>{busy ? "正在保存…" : editingVersion ? "保存修改" : online ? "保存到工作室" : "离线保存"}</button>{editingVersion > 0 && <button type="button" className="v2-secondary" onClick={resetEditor}>取消编辑</button>}</div></form>
      </section>
      <section className="v2-card"><header className="v2-card-head"><div><h2>最近记录</h2><p>所有设备读取同一版本；共享动作需要确认</p></div><span>{records.length} 条</span></header>
        {conflicts.length > 0 && <div className="v2-alert v2-error"><b>{conflicts.length} 条跨设备冲突</b>{conflicts.map((draft) => <div key={draft.id}><span>{draft.title}</span> <button onClick={() => loadConflictAsCopy(draft)}>载入并另存</button> <button onClick={() => discardConflict(draft)}>放弃本机版本</button></div>)}</div>}
        <div className="v2-record-list">{records.map((item) => <article key={item.id}><header><span>{labels[item.kind] || item.kind}</span><em className={`v2-status ${item.status === "confirmed" ? "completed" : "pending"}`}>{item.status === "confirmed" ? "已确认共享" : "教师草稿"}</em></header><h3>{item.title}</h3><p>{item.content}</p><small>{new Date(item.occurredAt).toLocaleString("zh-CN")} · {item.source.toUpperCase()} · v{item.version}</small><footer>{item.status !== "confirmed" && <button onClick={() => edit(item)} disabled={busy}>编辑</button>}{item.status !== "confirmed" && <button onClick={() => share(item)} disabled={busy || (!item.classId && !item.studentId)}>提交共享确认</button>}{item.status !== "confirmed" && <button onClick={() => remove(item)} disabled={busy}>删除草稿</button>}</footer></article>)}{!records.length && <div className="v2-empty"><b>还没有移动记录</b>先记下今天课堂里最值得跟进的一件事。</div>}</div>
      </section>
    </div>
  </>;
}
