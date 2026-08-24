"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Row = Record<string, unknown>;
type SettingsData = { current: Row; users: Row[]; students: Row[]; classes: Row[]; staffClassAccess: Row[]; logs: Row[] };
type AiData = { settings?: Row; usage?: Row; usageDetail?: Row; learning?: Row; learningRecords?: Row[] };
type SettingsTab = "members" | "mini" | "ai" | "audit" | "data";

const blank: SettingsData = { current: {}, users: [], students: [], classes: [], staffClassAccess: [], logs: [] };
const text = (value: unknown, fallback = "—") => String(value ?? "").trim() || fallback;
const number = (value: unknown) => Number(value || 0);
const enabled = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";
const roleLabel: Record<string, string> = { teacher: "教师", assistant: "助教", student: "学生", parent: "家长" };
const bindingStatusLabel: Record<string, string> = { pending: "待确认", active: "已生效", disabled: "已停用", rejected: "已拒绝" };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Row;
  if (!response.ok) throw new Error(text(payload.error, `请求失败（${response.status}）`));
  return payload;
}

export function SettingsWorkspace() {
  const [data, setData] = useState<SettingsData>(blank);
  const [routing, setRouting] = useState<Row>({});
  const [ai, setAi] = useState<AiData>({});
  const [bindings, setBindings] = useState<Row[]>([]);
  const [demoRuns, setDemoRuns] = useState<Row[]>([]);
  const [invite, setInvite] = useState<Row | null>(null);
  const [tab, setTab] = useState<SettingsTab>("members");
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [demoConfirmation, setDemoConfirmation] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [settings, routingResult, mini, aiResult, demo] = await Promise.all([
        request("/api/v2/settings"),
        request("/api/v2/settings/ai-routing"),
        request("/api/v2/mini/invites"),
        request("/api/v2/settings/ai"),
        request("/api/v2/settings/demo"),
      ]);
      setData(settings as unknown as SettingsData);
      setRouting(routingResult);
      setBindings(Array.isArray(mini.bindings) ? mini.bindings as Row[] : []);
      setAi(aiResult as AiData);
      setDemoRuns(Array.isArray(demo.runs) ? demo.runs as Row[] : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设置暂时无法读取");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, task: () => Promise<string>) => {
    if (busyKey) return;
    setBusyKey(key); setError(""); setNotice("");
    try { setNotice(await task()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
    finally { setBusyKey(""); }
  };

  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    await run("member", async () => {
      await request("/api/v2/settings", { method: "POST", body: JSON.stringify({ action: "upsertUser", ...fields, studentId: fields.studentId ? Number(fields.studentId) : null }) });
      form.reset(); await load(); return "成员与角色已保存；变更已经写入审计记录。";
    });
  };

  const disableMember = async (row: Row) => {
    if (!window.confirm(`停用“${text(row.name)}”的工作室账号？旧会话会立即失效。`)) return;
    await run(`disable:${row.id}`, async () => {
      await request("/api/v2/settings", { method: "POST", body: JSON.stringify({ action: "disableUser", userId: number(row.id) }) });
      await load(); return "账号已停用，原有登录会话已经撤销。";
    });
  };

  const saveScope = async (userId: number, classIds: number[]) => {
    await run(`scope:${userId}`, async () => {
      await request("/api/v2/settings", { method: "POST", body: JSON.stringify({ action: "setClassAccess", userId, classIds }) });
      await load(); return "助教班级范围已更新，下一次请求立即按新权限执行。";
    });
  };

  const createInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    await run("invite", async () => {
      const created = await request("/api/v2/mini/invites", { method: "POST", body: JSON.stringify({ studentId: Number(fields.studentId), role: fields.role }) });
      setInvite(created); return "邀请码已生成；微信用户输入后仍需教师在本页确认。";
    });
  };

  const decideMiniBinding = async (id: number, decision: "confirm" | "reject" | "disable") => {
    const label = decision === "confirm" ? "确认" : decision === "reject" ? "拒绝" : "停用";
    if (!window.confirm(`${label}这条绑定关系？停用后旧会话将立即失去该学生的数据权限。`)) return;
    await run(`binding:${id}`, async () => {
      await request(`/api/v2/mini/bindings/${id}`, { method: "POST", body: JSON.stringify({ decision }) });
      await load(); return `已${label}绑定；权限变化立即生效。`;
    });
  };

  const saveAi = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const current = ai.settings || {};
    const includeName = values.get("includeStudentName") === "on";
    if (includeName && !current.privacyAckAt && values.get("privacyAcknowledged") !== "on") {
      setError("开启实名上下文前，必须确认隐私说明。"); return;
    }
    await run("ai", async () => {
      const result = await request("/api/v2/settings/ai", { method: "PATCH", body: JSON.stringify({
        enabled: values.get("enabled") === "on",
        includeStudentName: includeName,
        emergencyDisabled: values.get("emergencyDisabled") === "on",
        privacyAcknowledged: values.get("privacyAcknowledged") === "on",
      }) });
      setAi(result as AiData); return "AI 辅助设置已保存；系统不按费用或 token 限制功能。";
    });
  };

  const clearLearning = async () => {
    if (!window.confirm("清空已匿名化的反馈写作学习样本？反馈原文不会被删除。")) return;
    await run("clear-learning", async () => {
      const result = await request("/api/v2/settings/ai", { method: "PATCH", body: JSON.stringify({ action: "clearLearning" }) });
      setAi(result as AiData); return "AI 写作学习样本已清空。";
    });
  };

  const setLearningActive = async (id: number, active: boolean) => {
    await run(`learning:${id}`, async () => {
      const result = await request("/api/v2/settings/ai", { method: "PATCH", body: JSON.stringify({ action: "setLearningActive", id, active }) });
      setAi(result as AiData); return active ? "该学习样本已重新启用。" : "该学习样本已停用。";
    });
  };

  const exportData = async () => {
    if (!window.confirm("导出文件可能包含学生姓名、评价和联系方式。确认在当前设备下载完整备份？")) return;
    await run("export", async () => {
      const payload = await request("/api/v2/settings/export", { cache: "no-store" });
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `知师研室数据备份-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0);
      return "完整数据备份已下载，并写入审计记录。";
    });
  };

  const seedDemo = async () => {
    if (!window.confirm("创建或补齐带“【演示】”标记的合成数据？真实教学记录不会被替换。")) return;
    await run("seed-demo", async () => { await request("/api/v2/settings/demo", { method: "POST" }); await load(); return "综合演示数据已经创建或核验。"; });
  };

  const clearDemo = async () => {
    if (demoConfirmation !== "清除演示数据") { setError("请输入“清除演示数据”后再继续。"); return; }
    if (!window.confirm("再次确认清除全部带“【演示】”标记的记录？真实教学数据不受影响。")) return;
    await run("clear-demo", async () => { await request("/api/v2/settings/demo", { method: "DELETE", body: JSON.stringify({ confirmation: demoConfirmation }) }); setDemoConfirmation(""); await load(); return "演示数据已清除，真实教学数据不受影响。"; });
  };

  const deleteAllData = async () => {
    if (deleteConfirmation !== "删除全部教学数据") { setError("请输入“删除全部教学数据”后再继续。"); return; }
    if (!window.confirm("这是不可恢复的永久删除。再次确认删除全部教学数据？账号与审计记录会保留。")) return;
    await run("delete-data", async () => { await request("/api/v2/settings/data", { method: "DELETE", body: JSON.stringify({ confirmation: deleteConfirmation }) }); setDeleteConfirmation(""); await load(); return "全部教学数据已永久删除，账号与审计记录仍保留。"; });
  };

  const models = (routing.models || {}) as Row;
  const jobs = (routing.jobs || []) as Row[];
  const aiSettings = ai.settings || {};
  const learningRecords = Array.isArray(ai.learningRecords) ? ai.learningRecords : [];
  const tabItems: Array<[SettingsTab, string]> = [["members", "成员与权限"], ["mini", "小程序绑定"], ["ai", "AI 与模型"], ["audit", "审计记录"], ["data", "备份与数据"]];

  return <>
    <section className="v2-workspace-toolbar v2-settings-tabs"><div className="v2-tabs">{tabItems.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div><button onClick={() => void load()} disabled={loading || Boolean(busyKey)}>↻ 刷新设置</button><small>当前账号：{text(data.current.accountLabel, "已配置")}</small></section>
    {error && <p className="v2-alert v2-error" role="alert">{error}</p>}{notice && <p className="v2-alert" role="status">{notice}</p>}
    <div className={loading ? "v2-loading" : ""}>
      {tab === "members" && <MembersTab data={data} busy={Boolean(busyKey)} saveMember={saveMember} disableMember={disableMember} saveScope={saveScope}/>}
      {tab === "mini" && <MiniTab data={data} bindings={bindings} invite={invite} busy={Boolean(busyKey)} createInvite={createInvite} decide={decideMiniBinding}/>}
      {tab === "ai" && <AiTab routing={routing} models={models} jobs={jobs} settings={aiSettings} learning={ai.learning || {}} learningRecords={learningRecords} busy={Boolean(busyKey)} save={saveAi} clearLearning={clearLearning} setLearningActive={setLearningActive}/>}
      {tab === "audit" && <AuditTab rows={data.logs}/>}
      {tab === "data" && <DataTab demoRuns={demoRuns} busy={Boolean(busyKey)} deleteConfirmation={deleteConfirmation} setDeleteConfirmation={setDeleteConfirmation} demoConfirmation={demoConfirmation} setDemoConfirmation={setDemoConfirmation} exportData={exportData} seedDemo={seedDemo} clearDemo={clearDemo} deleteAllData={deleteAllData}/>}
    </div>
  </>;
}

function MembersTab({ data, busy, saveMember, disableMember, saveScope }: { data: SettingsData; busy: boolean; saveMember: (event: FormEvent<HTMLFormElement>) => Promise<void>; disableMember: (row: Row) => Promise<void>; saveScope: (userId: number, classIds: number[]) => Promise<void> }) {
  return <div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>工作室成员</h2><p>学生与家长只能访问绑定档案；助教仅访问授权班级</p></div><span className="v2-status completed">{data.users.length} 个账号</span></header><div className="v2-native-list v2-member-list">{data.users.map((row) => <article key={String(row.id)}><div className="v2-avatar">{text(row.name).slice(0, 1)}</div><div><h3>{text(row.name)} <small>{text(row.email)}</small></h3><p>{text(row.roleNames, text(row.roles).split(",").map((role) => roleLabel[role] || role).join("、"))}</p><span>{text(row.roles).includes("assistant") ? Number(row.hasCredential) ? "可使用邮箱和独立密码登录" : "尚未设置登录密码" : text(row.status) === "active" ? "账号正常" : "账号已停用"}</span>{text(row.roles).includes("assistant") && <AssistantScopeEditor userId={number(row.id)} classes={data.classes} access={data.staffClassAccess} disabled={busy} save={saveScope}/>} {text(row.status) === "active" && number(row.id) !== number(data.current.id) && !/@(chatgpt\.com|local\.invalid)$/i.test(text(row.email, "")) && <button className="v2-row-inline-button" disabled={busy} onClick={() => void disableMember(row)}>停用账号</button>}</div><em className={`v2-status ${text(row.status) === "active" && (!text(row.roles).includes("assistant") || Number(row.hasCredential)) ? "completed" : "failed"}`}>{text(row.status) === "active" ? "已启用" : "已停用"}</em></article>)}</div></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>新增或更新成员</h2><p>相同邮箱会更新角色；密码留空时保留原助教密码</p></div></header><form className="v2-form" onSubmit={saveMember}><label>姓名<input name="name" required/></label><label>邮箱<input name="email" type="email" required/></label><label>角色<select name="role" required><option value="assistant">助教</option><option value="student">学生</option><option value="parent">家长</option></select></label><label>助教登录密码<input name="password" type="password" autoComplete="new-password" minLength={12}/><small>新助教必填；至少 12 位并包含多类字符。重设后旧会话立即失效。</small></label><label>绑定学生（学生/家长）<select name="studentId"><option value="">不绑定</option>{data.students.map((row) => <option value={String(row.id)} key={String(row.id)}>{text(row.name)} · {text(row.grade)}</option>)}</select></label><button className="v2-primary" disabled={busy}>{busy ? "保存中…" : "保存成员"}</button></form></section></div>;
}

function MiniTab({ data, bindings, invite, busy, createInvite, decide }: { data: SettingsData; bindings: Row[]; invite: Row | null; busy: boolean; createInvite: (event: FormEvent<HTMLFormElement>) => Promise<void>; decide: (id: number, decision: "confirm" | "reject" | "disable") => Promise<void> }) {
  return <div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>教师确认学生或家长绑定</h2><p>一期仅服务学生与家长；只开放教师已经确认并发布的学习内容</p></div><span className="v2-status completed">{bindings.length} 条绑定</span></header>{bindings.length ? <div className="v2-native-list v2-mini-binding-list">{bindings.map((row) => <article key={String(row.id)}><div className="v2-avatar">微</div><div><h3>{text(row.displayName, "微信用户")} → {text(row.studentName)}</h3><p>{roleLabel[text(row.role)] || text(row.role)} · 申请于 {text(row.createdAt).slice(0, 16)}</p><span>小程序不能访问教师草稿、答案或其他学生数据</span></div><div className="v2-mini-binding-actions"><em className={`v2-status ${text(row.status) === "active" ? "completed" : text(row.status) === "pending" ? "warning" : "failed"}`}>{bindingStatusLabel[text(row.status)] || text(row.status)}</em>{text(row.status) === "pending" && <><button disabled={busy} onClick={() => void decide(number(row.id), "confirm")}>确认</button><button disabled={busy} onClick={() => void decide(number(row.id), "reject")}>拒绝</button></>}{text(row.status) === "active" && <button disabled={busy} onClick={() => void decide(number(row.id), "disable")}>停用</button>}</div></article>)}</div> : <div className="v2-empty"><b>暂无绑定申请</b>学生或家长输入邀请码后，申请会出现在这里。</div>}</section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>生成一次性邀请码</h2><p>邀请码 7 天有效，使用后仍需教师确认</p></div></header><form className="v2-form" onSubmit={createInvite}><label>学生<select name="studentId" required defaultValue=""><option value="" disabled>请选择学生</option>{data.students.map((row) => <option value={String(row.id)} key={String(row.id)}>{text(row.name)} · {text(row.grade)}</option>)}</select></label><label>身份<select name="role" defaultValue="parent"><option value="parent">家长</option><option value="student">学生</option></select></label><button className="v2-primary" disabled={busy}>{busy ? "生成中…" : "生成邀请码"}</button></form>{invite && <label className="v2-secret-once">本次邀请码<input readOnly value={text(invite.code)}/><span>身份：{roleLabel[text(invite.role)] || text(invite.role)} · 有效期至 {text(invite.expiresAt).slice(0, 16)}</span></label>}<p className="v2-form-note">停用后旧会话会立即失去对应学生的数据权限；发布作业、批改、审批和正式反馈仍只能由教师端执行。</p></section></div>;
}

function AiTab({ routing, models, jobs, settings, learning, learningRecords, busy, save, clearLearning, setLearningActive }: { routing: Row; models: Row; jobs: Row[]; settings: Row; learning: Row; learningRecords: Row[]; busy: boolean; save: (event: FormEvent<HTMLFormElement>) => Promise<void>; clearLearning: () => Promise<void>; setLearningActive: (id: number, active: boolean) => Promise<void> }) {
  return <><section className="v2-metric-grid v2-four-metrics"><article className="v2-metric"><span>OpenCode 接口</span><b>{routing.configured ? "已连接" : "待配置"}</b><small>{text(routing.providerHost)}</small></article><article className="v2-metric"><span>选择策略</span><b>质量优先</b><small>不按费用或 token 限制功能</small></article><article className="v2-metric"><span>后台任务</span><b>{jobs.reduce((sum, row) => sum + number(row.total), 0)}</b><small>只保留技术性并发保护</small></article><article className="v2-metric"><span>学习样本</span><b>{number(learning.activeCount)}/{number(learning.count)}</b><small>启用数 / 总数</small></article></section><div className="v2-native-layout"><section className="v2-card"><header className="v2-card-head"><div><h2>多模型智能路由</h2><p>密钥仅存在服务器环境，页面只显示公开模型名称</p></div><em className={`v2-status ${routing.configured ? "completed" : "warning"}`}>{routing.configured ? "可用" : "未连接"}</em></header><div className="v2-model-grid">{[["fast", "快速识别"], ["reasoning", "深度推理"], ["vision", "图片与 PDF"], ["embedding", "语义向量"]].map(([key, label]) => <article key={key}><span>✦</span><div><b>{label}</b><small>{text(models[key])}</small></div></article>)}</div><p className="v2-ai-policy">功能不设置费用、调用次数或 token 上限；系统仅阻止重复任务、失控循环和供应商故障造成的无限重试。</p></section><section className="v2-card v2-sticky-card"><header className="v2-card-head"><div><h2>AI 使用与隐私</h2><p>默认匿名化；实名上下文必须由教师确认</p></div></header><form className="v2-form" onSubmit={save}><label className="v2-check"><input type="checkbox" name="enabled" defaultChecked={enabled(settings.enabled)}/>启用智能辅助</label><label className="v2-check"><input type="checkbox" name="includeStudentName" defaultChecked={enabled(settings.includeStudentName)}/>允许在单次必要场景发送学生姓名</label>{!settings.privacyAckAt && <label className="v2-check"><input type="checkbox" name="privacyAcknowledged"/>我已理解实名上下文的隐私边界</label>}<label className="v2-check"><input type="checkbox" name="emergencyDisabled" defaultChecked={enabled(settings.emergencyDisabled)}/>紧急停用全部旧版 AI 辅助</label><button className="v2-primary" disabled={busy}>{busy ? "保存中…" : "保存 AI 设置"}</button></form></section></div><section className="v2-card"><header className="v2-card-head"><div><h2>反馈写作学习样本</h2><p>样本已经匿名化，可逐条停用；不会修改反馈原文</p></div><button className="v2-danger-action" disabled={busy || !learningRecords.length} onClick={() => void clearLearning()}>清空学习样本</button></header>{learningRecords.length ? <div className="v2-native-list compact">{learningRecords.map((row) => <article key={String(row.id)}><div className="v2-avatar">学</div><div><h3>{text(row.stage)} · {text(row.grade)}</h3><p>{text(row.audience)} · {text(row.tone)}</p><span>{text(row.createdAt)}</span></div><button className="v2-row-inline-button" disabled={busy} onClick={() => void setLearningActive(number(row.id), !enabled(row.active))}>{enabled(row.active) ? "停用" : "启用"}</button></article>)}</div> : <div className="v2-empty"><b>暂无学习样本</b>教师采用并发送反馈后，匿名化样本才会进入这里。</div>}</section></>;
}

function AuditTab({ rows }: { rows: Row[] }) {
  return <section className="v2-card"><header className="v2-card-head"><div><h2>最近审计记录</h2><p>正式写入、角色变化、AI 采用结果与敏感动作均可追溯</p></div><span className="v2-status completed">最近 {rows.length} 条</span></header><div className="v2-table"><table><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>编号</th><th>摘要</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td>{text(row.createdAt)}</td><td>{text(row.userName, "系统")}</td><td>{text(row.action)}</td><td>{text(row.entityType)}</td><td>{text(row.entityId)}</td><td><small>{text(row.detail, "")}</small></td></tr>)}</tbody></table></div></section>;
}

function DataTab({ demoRuns, busy, deleteConfirmation, setDeleteConfirmation, demoConfirmation, setDemoConfirmation, exportData, seedDemo, clearDemo, deleteAllData }: { demoRuns: Row[]; busy: boolean; deleteConfirmation: string; setDeleteConfirmation: (value: string) => void; demoConfirmation: string; setDemoConfirmation: (value: string) => void; exportData: () => Promise<void>; seedDemo: () => Promise<void>; clearDemo: () => Promise<void>; deleteAllData: () => Promise<void> }) {
  return <div className="v2-settings-data-grid"><section className="v2-card"><header className="v2-card-head"><div><h2>完整数据备份</h2><p>导出当前工作室全部教学数据，文件可能包含学生身份与评价信息</p></div></header><button className="v2-primary" disabled={busy} onClick={() => void exportData()}>下载 JSON 备份</button><p className="v2-form-note">只在受信任设备保存，使用完成后请妥善保管或删除。</p></section><section className="v2-card"><header className="v2-card-head"><div><h2>合成演示数据</h2><p>用于上线前验收，不复制旧站或真实学生信息</p></div><span className="v2-status completed">{demoRuns.length} 次记录</span></header><div className="v2-detail-actions"><button className="v2-primary" disabled={busy} onClick={() => void seedDemo()}>创建或补齐演示数据</button></div><label className="v2-danger-confirm">输入“清除演示数据”<input value={demoConfirmation} onChange={(event) => setDemoConfirmation(event.target.value)}/></label><button className="v2-danger-action" disabled={busy || demoConfirmation !== "清除演示数据"} onClick={() => void clearDemo()}>清除演示数据</button><p className="v2-form-note">仅删除带“【演示】”标记并由系统追踪的记录，真实教学数据不受影响。</p></section><section className="v2-card v2-danger-zone"><header className="v2-card-head"><div><h2>永久删除全部教学数据</h2><p>账号和审计记录保留，其余教学、题库、作业、文件索引等数据不可恢复</p></div><span className="v2-status failed">危险操作</span></header><label className="v2-danger-confirm">输入“删除全部教学数据”<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)}/></label><button className="v2-danger-action" disabled={busy || deleteConfirmation !== "删除全部教学数据"} onClick={() => void deleteAllData()}>永久删除全部教学数据</button></section></div>;
}

function AssistantScopeEditor({ userId, classes, access, disabled, save }: { userId: number; classes: Row[]; access: Row[]; disabled: boolean; save: (userId: number, classIds: number[]) => Promise<void> }) {
  const initial = useMemo(() => access.filter((row) => number(row.userId) === userId).map((row) => number(row.classId)), [access, userId]);
  const [selected, setSelected] = useState<number[]>(initial);
  useEffect(() => { setSelected(initial); }, [initial]);
  return <fieldset className="v2-staff-scope"><legend>可访问班级</legend><div>{classes.map((row) => { const id = number(row.id); return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, id])] : current.filter((item) => item !== id))}/>{text(row.name)}</label>; })}</div><button type="button" disabled={disabled} onClick={() => void save(userId, selected)}>保存班级范围</button></fieldset>;
}
