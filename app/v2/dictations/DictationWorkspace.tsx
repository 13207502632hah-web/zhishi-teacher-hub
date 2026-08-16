"use client";

import Link from "../../components/HardNavigationLink";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Upload = { id: number; name: string };
const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const number = (value: unknown) => Number(value || 0);

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(text(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function DictationWorkspace() {
  const [items, setItems] = useState<Row[]>([]), [classes, setClasses] = useState<Row[]>([]), [counts, setCounts] = useState<Row>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [query, setQuery] = useState(""), [assets, setAssets] = useState<Upload[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [tasks, classData] = await Promise.all([json("/api/v2/dictations"), json("/api/v2/classes?status=active&pageSize=200")]);
      setItems((tasks.assignments || []) as Row[]); setCounts((tasks.counts || {}) as Row); setClasses((classData.classes || []) as Row[]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "听写任务读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return; setUploading(true); setError("");
    try {
      const saved: Upload[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData(); form.append("file", file);
        const response = await fetch("/api/v2/assignments/files", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({})) as Row;
        if (!response.ok) throw new Error(text(payload.error, `${file.name} 上传失败`));
        saved.push({ id: number(payload.id), name: text(payload.name, file.name) });
      }
      setAssets((current) => [...current, ...saved]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "示范附件上传失败"); }
    finally { setUploading(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget, values = new FormData(form), lines = text(values.get("content"), "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      await json("/api/v2/dictations", { method: "POST", body: JSON.stringify({
        mode: values.get("mode"), title: values.get("title"), classId: Number(values.get("classId")), dueAt: values.get("dueAt") || null,
        requirements: values.get("requirements"), contentItems: lines, assetIds: assets.map((item) => item.id),
        allowParentSubmit: values.get("allowParentSubmit") === "on", requireRevision: values.get("requireRevision") === "on", operationId: crypto.randomUUID(),
      }) });
      form.reset(); setAssets([]); setNotice("听写任务草稿已建立；学生端尚不可见，请核对后提交发布确认。"); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "草稿保存失败"); }
    finally { setBusy(false); }
  };

  const publish = async (item: Row) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await json("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "assignment.publish", entityType: "assignment", entityId: String(item.id), title: `发布${text(item.kind) === "follow_reading" ? "跟读" : "听写"}：${text(item.title)}`, summary: `向 ${number(item.recipientCount)} 名学生发布，截止时间 ${text(item.dueAt, "未设置")}。`, payload: { id: number(item.id), dueAt: item.dueAt }, evidence: [{ type: "dictation", id: item.id, mode: item.kind, itemCount: Array.isArray(item.contentItems) ? item.contentItems.length : 0, attachments: item.assetCount }] }) });
      setNotice("发布动作已进入待确认中心；批准前学生端仍不可见。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交发布确认失败"); }
    finally { setBusy(false); }
  };

  const visible = items.filter((item) => !query || [item.title, item.className, item.requirements].some((value) => text(value, "").toLowerCase().includes(query.toLowerCase())));
  return <>
    <section className="v2-workspace-toolbar"><label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选任务、班级或要求…"/></label><button onClick={() => void load()} disabled={loading}>↻ 刷新数据</button><small>网站建草稿 · 小程序提交 · 统一批改与订正</small></section>
    {error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}
    <section className="v2-metric-grid v2-four-metrics"><article className="v2-metric"><span>任务总数</span><b>{number(counts.total)}</b><small>跟读与听写</small></article><article className="v2-metric"><span>草稿</span><b>{number(counts.draft)}</b><small>学生端不可见</small></article><article className="v2-metric"><span>待批改</span><b>{number(counts.pendingReview)}</b><small>共用作业队列</small></article><article className="v2-metric"><span>待订正</span><b>{number(counts.revision)}</b><small>已确认反馈</small></article></section>
    <div className={`v2-native-layout ${loading ? "v2-loading" : ""}`}><section className="v2-card"><header className="v2-card-head"><div><h2>任务与完成进度</h2><p>听写内容仅在教师端保存；小程序只显示要求、数量和示范附件</p></div><Link className="v2-row-action" href="/v2/modules/assignments">统一批改</Link></header><div className="v2-native-list">{visible.map((item) => <article key={String(item.id)}><div className="v2-avatar">{text(item.kind) === "follow_reading" ? "读" : "听"}</div><div><h3>{text(item.title)} <small>{text(item.className, "指定学生")}</small></h3><p>{text(item.kind) === "follow_reading" ? "跟读" : "听写"} · {Array.isArray(item.contentItems) ? item.contentItems.length : 0} 条 · 附件 {number(item.assetCount)}</p><span>待批 {number(item.pendingReviewCount)} · 待订正 {number(item.revisionCount)} · 完成 {number(item.completedCount)}</span>{text(item.status) === "draft" && <button className="v2-row-inline-button" disabled={busy} onClick={() => void publish(item)}>提交发布确认</button>}</div><em className={`v2-status ${text(item.status) === "draft" ? "warning" : "completed"}`}>{text(item.status) === "draft" ? "草稿" : "已发布"}</em></article>)}{!visible.length && <div className="v2-empty"><b>还没有跟读或听写任务</b>从右侧建立第一份草稿。</div>}</div></section>
      <section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>建立任务草稿</h2><p>正式发布前可继续核对</p></div></header><form className="v2-form" onSubmit={submit}><label>训练方式<select name="mode" defaultValue="dictation"><option value="dictation">听写</option><option value="follow_reading">跟读</option></select></label><label>标题<input name="title" required maxLength={120} placeholder="如：第 3 单元核心概念听写"/></label><label>班级<select name="classId" required><option value="">请选择</option>{classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{text(item.name)} · {text(item.grade)}</option>)}</select></label><label>截止时间<input name="dueAt" type="datetime-local"/></label><label>训练内容（每行一条）<textarea name="content" rows={8} required placeholder={'人民代表大会制度\n全过程人民民主\n基层群众自治制度'}/><small>听写模式下这些内容不会直接显示给学生；跟读模式会显示原文。</small></label><label>学生端要求<textarea name="requirements" rows={4} placeholder="录音前安静准备，完成后检查再提交"/></label><label className="v2-file-picker">示范音频或材料<input type="file" multiple accept="audio/*,.mp3,.m4a,.pdf,.docx,image/*" onChange={(event) => void upload(event.target.files)}/><small>{uploading ? "正在上传…" : assets.length ? assets.map((item) => item.name).join("、") : "听写建议上传教师朗读音频；跟读可上传示范音频"}</small></label><label className="v2-check"><input name="allowParentSubmit" type="checkbox" defaultChecked/>允许家长代交</label><label className="v2-check"><input name="requireRevision" type="checkbox" defaultChecked/>需要保留订正版</label><button className="v2-primary" disabled={busy || uploading}>{busy ? "正在保存…" : "建立草稿"}</button><small className="v2-form-note">学生提交的语音和文字始终通过鉴权接口访问。</small></form></section></div>
  </>;
}
