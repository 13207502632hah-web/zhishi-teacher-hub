"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
type SettingsData = { current: Row; users: Row[]; students: Row[]; classes: Row[]; staffClassAccess: Row[]; logs: Row[] };
const blank: SettingsData = { current: {}, users: [], students: [], classes: [], staffClassAccess: [], logs: [] };
const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const roleLabel: Record<string, string> = { teacher: "教师", assistant: "助教", student: "学生", parent: "家长" };

async function read(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(text(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function SettingsWorkspace() {
  const [data, setData] = useState<SettingsData>(blank), [routing, setRouting] = useState<Row>({}), [tab, setTab] = useState<"members" | "ai" | "audit">("members"), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const [settings, ai] = await Promise.all([read("/api/v2/settings"), read("/api/v2/settings/ai-routing")]); setData(settings as unknown as SettingsData); setRouting(ai); } catch (caught) { setError(caught instanceof Error ? caught.message : "设置暂时无法读取"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);

  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); const form = event.currentTarget, fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    try { await read("/api/v2/settings", { method: "POST", body: JSON.stringify({ action: "upsertUser", ...fields, studentId: fields.studentId ? Number(fields.studentId) : null }) }); form.reset(); setNotice("成员与角色已保存；变更已经写入审计记录。"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "成员保存失败"); }
    finally { setBusy(false); }
  };

  const saveScope = async (userId: number, classIds: number[]) => {
    setBusy(true); setError(""); setNotice("");
    try { await read("/api/v2/settings", { method: "POST", body: JSON.stringify({ action: "setClassAccess", userId, classIds }) }); setNotice("助教班级范围已更新，下一次请求立即按新权限执行。"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "助教权限保存失败"); }
    finally { setBusy(false); }
  };

  const models = (routing.models || {}) as Row, jobs = (routing.jobs || []) as Row[];
  return <><section className="v2-workspace-toolbar v2-settings-tabs"><div className="v2-tabs">{[["members", "成员与权限"], ["ai", "AI 路由"], ["audit", "审计记录"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key as typeof tab)}>{label}</button>)}</div><button onClick={() => void load()} disabled={loading}>↻ 刷新设置</button><small>当前账号：{text(data.current.accountLabel, "已配置")}</small></section>{error && <p className="v2-alert v2-error">{error}</p>}{notice && <p className="v2-alert">{notice}</p>}<div className={loading ? "v2-loading" : ""}>
    {tab === "members" && <div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>工作室成员</h2><p>学生与家长只能访问绑定档案；助教仅访问授权班级</p></div><span className="v2-status completed">{data.users.length} 个账号</span></header><div className="v2-native-list v2-member-list">{data.users.map((row) => <article key={String(row.id)}><div className="v2-avatar">{text(row.name).slice(0, 1)}</div><div><h3>{text(row.name)} <small>{text(row.email)}</small></h3><p>{text(row.roleNames, text(row.roles).split(",").map((role) => roleLabel[role] || role).join("、"))}</p><span>{text(row.roles).includes("assistant") ? Number(row.hasCredential) ? "可使用邮箱和独立密码登录" : "尚未设置登录密码" : text(row.status) === "active" ? "账号正常" : "账号已停用"}</span>{text(row.roles).includes("assistant") && <AssistantScopeEditor userId={Number(row.id)} classes={data.classes} access={data.staffClassAccess} disabled={busy} save={saveScope}/>}</div><em className={`v2-status ${text(row.status) === "active" && (!text(row.roles).includes("assistant") || Number(row.hasCredential)) ? "completed" : "failed"}`}>{text(row.status) === "active" ? "已启用" : "已停用"}</em></article>)}</div></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>新增或更新成员</h2><p>相同邮箱会更新角色；密码留空时保留原助教密码</p></div></header><form className="v2-form" onSubmit={saveMember}><label>姓名<input name="name" required/></label><label>邮箱<input name="email" type="email" required/></label><label>角色<select name="role" required><option value="assistant">助教</option><option value="student">学生</option><option value="parent">家长</option></select></label><label>助教登录密码<input name="password" type="password" autoComplete="new-password" minLength={12}/><small>新助教必填；至少 12 位并包含多类字符。重设后旧会话立即失效。</small></label><label>绑定学生（学生/家长）<select name="studentId"><option value="">不绑定</option>{data.students.map((row) => <option value={String(row.id)} key={String(row.id)}>{text(row.name)} · {text(row.grade)}</option>)}</select></label><button className="v2-primary" disabled={busy}>{busy ? "保存中…" : "保存成员"}</button></form></section></div>}
    {tab === "ai" && <><section className="v2-metric-grid v2-four-metrics"><article className="v2-metric"><span>OpenCode 接口</span><b>{routing.configured ? "已连接" : "待配置"}</b><small>{text(routing.providerHost)}</small></article><article className="v2-metric"><span>选择策略</span><b>质量优先</b><small>不按费用或 token 限制功能</small></article><article className="v2-metric"><span>运行任务</span><b>{jobs.reduce((sum, row) => sum + Number(row.total || 0), 0)}</b><small>只保留技术性并发保护</small></article><article className="v2-metric"><span>隐私边界</span><b>默认匿名</b><small>实名上下文需单次确认</small></article></section><section className="v2-card"><header className="v2-card-head"><div><h2>多模型智能路由</h2><p>密钥仅存在于服务器环境，以下只显示公开模型名称</p></div><em className={`v2-status ${routing.configured ? "completed" : "warning"}`}>{routing.configured ? "可用" : "未连接"}</em></header><div className="v2-model-grid">{[["fast", "快速识别"], ["reasoning", "深度推理"], ["vision", "图片与 PDF"], ["embedding", "语义向量"]].map(([key, label]) => <article key={key}><span>✦</span><div><b>{label}</b><small>{text(models[key])}</small></div></article>)}</div><p className="v2-ai-policy">功能不设置费用或 token 上限；后台仍会阻止重复任务、失控循环和供应商故障导致的无限重试。</p></section></>}
    {tab === "audit" && <section className="v2-card"><header className="v2-card-head"><div><h2>最近审计记录</h2><p>正式写入、角色变化、AI 采用结果与敏感动作均可追溯</p></div><span className="v2-status completed">最近 {data.logs.length} 条</span></header><div className="v2-table"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>编号</th><th>摘要</th></tr></thead><tbody>{data.logs.map((row) => <tr key={String(row.id)}><td>{text(row.createdAt)}</td><td>{text(row.userName, "系统")}</td><td>{text(row.action)}</td><td>{text(row.entityType)}</td><td>{text(row.entityId)}</td><td><small>{text(row.detail, "")}</small></td></tr>)}</tbody></table></div></section>}
  </div></>;
}

function AssistantScopeEditor({ userId, classes, access, disabled, save }: { userId: number; classes: Row[]; access: Row[]; disabled: boolean; save: (userId: number, classIds: number[]) => Promise<void> }) {
  const [selected, setSelected] = useState<number[]>(() => access.filter((row) => Number(row.userId) === userId).map((row) => Number(row.classId)));
  useEffect(() => { setSelected(access.filter((row) => Number(row.userId) === userId).map((row) => Number(row.classId))); }, [access, userId]);
  return <fieldset className="v2-staff-scope"><legend>可访问班级</legend><div>{classes.map((row) => { const id = Number(row.id); return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))}/>{text(row.name)}</label>; })}</div><button type="button" disabled={disabled} onClick={() => void save(userId, selected)}>保存班级范围</button></fieldset>;
}
