"use client";

import Link from "../../../../components/HardNavigationLink";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
const text = (input: unknown, fallback = "—") => String(input ?? "").trim() || fallback;

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(text(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function EntityDetail({ id }: { id: number }) {
  const [data, setData] = useState<Row>({}), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await json(`/api/v2/resources/${id}`)); } catch (caught) { setError(caught instanceof Error ? caught.message : "详情暂时无法读取"); } finally { setLoading(false); } }, [id]);
  useEffect(() => { void load(); }, [load]);

  const update = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setSaving(true); setError(""); setNotice(""); const fields = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; try { await json(`/api/v2/resources/${id}`, { method: "PUT", body: JSON.stringify(fields) }); setNotice("详情已更新并写入审计记录。"); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); } };
  const publishResource = async () => { setSaving(true); setError(""); setNotice(""); try { const item = (data.resource || {}) as Row; await json("/api/v2/approvals", { method: "POST", body: JSON.stringify({ actionType: "resource.publish", entityType: "resource", entityId: id, title: `公开资源：${text(item.title)}`, summary: "公开后匿名访客可在资源中心查看；请确认内容不包含学生、家长、联系方式、评价或个别反馈。", payload: { id }, evidence: [{ type: "resource", id, title: item.title, visibility: item.visibility }] }) }); setNotice("资源公开请求已进入待确认中心；批准前仍保持私有。"); } catch (caught) { setError(caught instanceof Error ? caught.message : "资源公开确认创建失败"); } finally { setSaving(false); } };
  const deleteResource = async () => { const item = (data.resource || {}) as Row; if (!window.confirm(`永久删除资源“${text(item.title)}”？此操作不可恢复。`)) return; setSaving(true); setError(""); try { await json(`/api/v2/resources/${id}`, { method: "DELETE" }); window.location.assign("/v2/modules/resources"); } catch (caught) { setError(caught instanceof Error ? caught.message : "资源删除失败"); setSaving(false); } };
  const title = text(((data.resource || {}) as Row).name || ((data.resource || {}) as Row).title, "资源详情");
  return <><section className="v2-detail-head"><div><Link href="/v2/modules/resources">← 返回资源中心</Link><p className="v2-eyebrow">V2 NATIVE DETAIL · #{id}</p><h2>{title}</h2><span>资源详情与列表使用同一版本化业务数据</span></div><Link className="v2-secondary-on-light" href="/v2/assistant">✦ 让 AI 分析当前证据</Link></section>{error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}<div className={loading ? "v2-loading" : ""}><ResourceDetail data={data} update={update} publish={publishResource} remove={deleteResource} saving={saving}/></div></>;
}

function ResourceDetail({ data, update, publish, remove, saving }: { data: Row; update: (event: FormEvent<HTMLFormElement>) => void; publish: () => Promise<void>; remove: () => Promise<void>; saving: boolean }) {
  const item = (data.resource || {}) as Row;
  const isPublic = text(item.visibility, "private") === "public";
  return <><Metric items={[["可见范围", isPublic ? "公开" : "私有"], ["类型", text(item.type, "素材")], ["来源", text(item.sourceRef, "手工录入")], ["最后更新", text(item.updatedAt)]]}/><section className="v2-card"><Header title="编辑资源内容" detail="外部链接只允许 HTTP/HTTPS；公开前必须在待确认中心再次核对隐私边界"/><form className="v2-form v2-edit-grid" onSubmit={update}><label>资源名称<input name="title" defaultValue={text(item.title, "")} required/></label><label>类型<select name="type" defaultValue={text(item.type, "备课素材")}><option>备课素材</option><option>教学策略</option><option>课件</option><option>外部链接</option><option>AI 学情报告</option></select></label><label>外部链接<input name="url" type="url" defaultValue={text(item.url, "")} placeholder="https://"/></label><label>标签<input name="tags" defaultValue={text(item.tags, "")} placeholder="高二, 论述题"/></label><label className="v2-detail-wide">正文与摘要<textarea name="content" defaultValue={text(item.content, "")} rows={14}/></label><button className="v2-primary" disabled={saving}>{saving ? "保存中…" : "保存资源"}</button></form><div className="v2-detail-actions">{Boolean(item.url) && <a className="v2-secondary-on-light" href={text(item.url, "#")} target="_blank" rel="noreferrer">打开外部链接</a>}{isPublic ? <Link className="v2-secondary-on-light" href={`/resources/${item.id}`}>查看公开页面</Link> : <button className="v2-primary" disabled={saving} onClick={() => void publish()}>提交公开确认</button>}<button className="v2-danger-action" disabled={saving} onClick={() => void remove()}>永久删除资源</button></div>{!isPublic && <p className="v2-ai-policy">公开前请确认不包含学生、家长、联系方式、评价、个别反馈或可识别的课堂记录。</p>}</section></>;
}

function Metric({ items }: { items: Array<[string, string | number]> }) { return <section className="v2-metric-grid v2-four-metrics">{items.map(([label, value]) => <article className="v2-metric" key={label}><span>{label}</span><b>{value}</b><small>来自当前业务记录</small></article>)}</section>; }
function Header({ title, detail }: { title: string; detail: string }) { return <header className="v2-card-head"><div><h2>{title}</h2><p>{detail}</p></div></header>; }
