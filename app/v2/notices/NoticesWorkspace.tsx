"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const number = (value: unknown) => Number(value || 0);
const audienceNames: Record<string, string> = { student: "仅学生", parent: "仅家长", both: "学生与家长" };

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }), payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(text(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function NoticesWorkspace() {
  const [notices, setNotices] = useState<Row[]>([]), [classes, setClasses] = useState<Row[]>([]), [counts, setCounts] = useState<Row>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const [messageData, classData] = await Promise.all([json("/api/v2/notices"), json("/api/v2/classes?status=active&pageSize=200")]); setNotices((messageData.notices || []) as Row[]); setCounts((messageData.counts || {}) as Row); setClasses((classData.classes || []) as Row[]); } catch (reason) { setError(reason instanceof Error ? reason.message : "家校消息读取失败"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
    try { await json("/api/v2/notices", { method: "POST", body: JSON.stringify({ ...values, classId: Number(values.classId), operationId: crypto.randomUUID() }) }); form.reset(); setNotice("通知草稿已保存；提交并批准发布前，小程序不会显示。"); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "通知草稿保存失败"); } finally { setBusy(false); }
  }
  async function publish(item: Row) {
    setBusy(true); setError(""); setNotice("");
    try { await json("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "class_notice.publish", entityType: "class_notice", entityId: String(item.id), title: `发布家校通知：${text(item.title)}`, summary: `向“${text(item.className)}”的${audienceNames[text(item.audienceRole)] || "已绑定账号"}发布通知。`, payload: { id: number(item.id) }, evidence: [{ type: "class_notice", id: item.id, classId: item.classId, audienceRole: item.audienceRole, recipientCount: item.recipientCount }] }) }); setNotice("通知发布已进入待确认中心；批准前学生和家长仍不可见。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "提交发布确认失败"); } finally { setBusy(false); }
  }
  async function archive(item: Row) {
    if (!window.confirm(`确认撤回“${text(item.title)}”？小程序将不再显示，已读回执仍保留用于审计。`)) return;
    setBusy(true); setError(""); try { await json(`/api/v2/notices/${item.id}`, { method: "DELETE" }); setNotice("通知已撤回；历史已读和知晓回执仍保留。"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "撤回通知失败"); } finally { setBusy(false); }
  }

  return <>{error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}<section className="v2-metric-grid v2-four-metrics v2-notice-metrics"><article className="v2-metric"><span>当前通知</span><b>{number(counts.total)}</b><small>不含已撤回</small></article><article className="v2-metric"><span>待发布草稿</span><b>{number(counts.draft)}</b><small>小程序不可见</small></article><article className="v2-metric"><span>已发布</span><b>{number(counts.published)}</b><small>{number(counts.recipients)} 个接收身份</small></article><article className="v2-metric"><span>尚未阅读</span><b>{number(counts.unread)}</b><small>按账号与学生分别统计</small></article></section><div className={`v2-native-layout ${loading ? "v2-loading" : ""}`}><section className="v2-card"><header className="v2-card-head"><div><h2>通知与回执</h2><p>“已读”表示打开正文，“已知晓”表示主动确认</p></div><button className="v2-row-inline-button" onClick={() => void load()}>↻ 刷新</button></header><div className="v2-native-list v2-notice-list">{notices.map((item) => { const recipients = number(item.recipientCount), read = number(item.readCount), acknowledged = number(item.acknowledgedCount); return <article key={String(item.id)}><div className="v2-avatar">信</div><div><h3>{text(item.title)} <small>{text(item.className)}</small></h3><p>{audienceNames[text(item.audienceRole)] || text(item.audienceRole)} · {text(item.publishedAt, "尚未发布")}</p><span>{text(item.content).slice(0, 180)}</span>{item.status === "published" && <div className="v2-receipt-progress"><div><i style={{ width: `${recipients ? Math.min(100, read / recipients * 100) : 0}%` }}/></div><small>已读 {read}/{recipients} · 已知晓 {acknowledged}/{recipients}</small></div>}<div className="v2-inline-actions">{item.status === "draft" && <button className="v2-row-inline-button" disabled={busy} onClick={() => void publish(item)}>提交发布确认</button>}<button className="v2-row-inline-button" disabled={busy} onClick={() => void archive(item)}>撤回并归档</button></div></div><em className={`v2-status ${item.status === "published" ? "completed" : "warning"}`}>{item.status === "published" ? "已发布" : "草稿"}</em></article>; })}{!notices.length && <div className="v2-empty"><b>还没有家校通知</b>先在右侧建立一份草稿。</div>}</div></section><section className="v2-card v2-sticky-card" id="create-notice"><header className="v2-card-head"><div><h2>新建通知草稿</h2><p>不会立即出现在小程序</p></div></header><form className="v2-form" onSubmit={create}><label>所属班级<select name="classId" required><option value="">请选择</option>{classes.map((item) => <option key={String(item.id)} value={String(item.id)}>{text(item.name)} · {text(item.grade)}</option>)}</select></label><label>接收身份<select name="audienceRole"><option value="both">学生与家长</option><option value="parent">仅家长</option><option value="student">仅学生</option></select></label><label>通知标题<input name="title" required maxLength={160} placeholder="如：本周六上课时间调整说明"/></label><label>通知正文<textarea name="content" required rows={9} maxLength={8000} placeholder="写清时间、事项和需要家长或学生完成的动作"/></label><button className="v2-primary" disabled={busy}>{busy ? "正在保存…" : "保存通知草稿"}</button><small className="v2-form-note">本功能不开放自由聊天；涉及正式发送时仍由主教师在待确认中心批准。</small></form></section></div></>;
}
