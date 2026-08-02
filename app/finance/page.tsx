"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, EmptyState } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./finance.module.css";

type ResourceState = "idle" | "loading" | "ready" | "error";
type FinanceItem = Record<string, any> & {
  id?: number;
  lessonId?: number;
  date?: string;
  startTime?: string;
  courseName?: string;
  topic?: string;
  pricingRuleId?: number | null;
  expectedAmount?: number | null;
  receivedAmount?: number | null;
  difference?: number | null;
  status?: string | null;
};
type Totals = {
  expected?: number | null;
  received?: number | null;
  pendingAmount?: number | null;
  underpaidAmount?: number | null;
  overpaidAmount?: number | null;
  reviewAmount?: number | null;
};
type FinanceResponse = { items?: FinanceItem[]; totals?: Totals };
type ContextResponse = Record<string, any> & {
  source?: Record<string, any> | null;
  exceptions?: Array<{ type?: string; message?: string }>;
  canConfirm?: boolean;
  institutions?: Array<Record<string, any>>;
  students?: Array<Record<string, any>>;
};
type PreviewResponse = {
  preview?: Record<string, any> & { items?: Array<Record<string, any>> };
  formula?: string;
  snapshot?: Record<string, any>;
  previewToken?: string;
  expiresAt?: string;
  context?: {
    source?: Record<string, any> | null;
    exceptions?: Array<{ type?: string; message?: string }>;
    canConfirm?: boolean;
  };
};
type MonthlyResponse = Record<string, any> & {
  summary?: Record<string, any>;
  items?: FinanceItem[];
};

const statusLabels: Record<string, string> = {
  review: "待核对",
  pending: "待收",
  underpaid: "少收",
  overpaid: "超收",
  settled: "已收清",
};

const createOperationId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const formatMoney = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "—";
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "—";
};

const formatCount = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));

const formatStatus = (value: unknown) => statusLabels[String(value || "")] || "异常";

const isAbortError = (reason: unknown, signal?: AbortSignal) => Boolean(signal?.aborted) || (reason instanceof Error && reason.name === "AbortError");

const errorMessage = (reason: unknown, fallback: string) => {
  if (reason instanceof HttpError) {
    const payload = reason.payload as { exceptions?: Array<{ message?: string }> } | null;
    const exceptions = payload?.exceptions?.map((item) => item.message).filter(Boolean) || [];
    return exceptions.length ? `${reason.message}：${exceptions.join("；")}` : reason.message;
  }
  return reason instanceof Error ? reason.message : fallback;
};

const parseAdjustment = (value: string) => {
  if (!value.trim()) return { value: null as number | null, error: "手工调整金额不能为空；无调整时请输入 0。" };
  const parsed = Number(value);
  return Number.isFinite(parsed) ? { value: parsed, error: "" } : { value: null as number | null, error: "手工调整金额必须是有效数字。" };
};

function ResourceError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <div className={styles.errorBox} role="alert"><div><strong>{title}</strong><p>{message}</p></div><button className={styles.secondaryButton} type="button" onClick={onRetry}>重新读取</button></div>;
}

function LoadingLine({ label }: { label: string }) {
  return <p className={styles.loadingLine} role="status">正在读取{label}…</p>;
}

export default function FinancePage() {
  const [items, setItems] = useState<FinanceItem[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [lessons, setLessons] = useState<Array<Record<string, any>>>([]);
  const [lessonId, setLessonId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [adjustment, setAdjustment] = useState("0");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [payerType, setPayerType] = useState("institution");
  const [payerId, setPayerId] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewExpired, setPreviewExpired] = useState(false);
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()));
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  const [financeState, setFinanceState] = useState<ResourceState>("idle");
  const [lessonsState, setLessonsState] = useState<ResourceState>("idle");
  const [contextState, setContextState] = useState<ResourceState>("idle");
  const [monthlyState, setMonthlyState] = useState<ResourceState>("idle");
  const [financeError, setFinanceError] = useState("");
  const [lessonsError, setLessonsError] = useState("");
  const [contextError, setContextError] = useState("");
  const [monthlyError, setMonthlyError] = useState("");
  const [financeRetry, setFinanceRetry] = useState(0);
  const [lessonsRetry, setLessonsRetry] = useState(0);
  const [contextRetry, setContextRetry] = useState(0);
  const [monthlyRetry, setMonthlyRetry] = useState(0);
  const [actionBusy, setActionBusy] = useState<"preview" | "confirm" | null>(null);

  const adjustmentState = useMemo(() => parseAdjustment(adjustment), [adjustment]);
  const hasNonZeroAdjustment = adjustmentState.value !== null && adjustmentState.value !== 0;

  const retryFinance = () => setFinanceRetry((value) => value + 1);
  const retryLessons = () => setLessonsRetry((value) => value + 1);
  const retryMonthly = () => setMonthlyRetry((value) => value + 1);
  const retryContext = () => setContextRetry((value) => value + 1);

  const loadFinanceList = useCallback(async (signal: AbortSignal) => {
    setFinanceState("loading");
    setFinanceError("");
    const query = new URLSearchParams({ lessonId, status: statusFilter });
    try {
      const data = await requestJson<FinanceResponse>(`/api/finance?${query}`, { signal, cache: "no-store" });
      if (!data) throw new HttpError(204, "课时账目接口没有返回数据");
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotals(data.totals || null);
      setFinanceState("ready");
    } catch (reason) {
      if (isAbortError(reason, signal)) return;
      setFinanceError(errorMessage(reason, "读取课时账目失败"));
      setFinanceState("error");
    }
  }, [lessonId, statusFilter]);

  const loadLessons = useCallback(async (signal: AbortSignal) => {
    setLessonsState("loading");
    setLessonsError("");
    try {
      const data = await requestJson<{ lessons?: Array<Record<string, any>> }>("/api/lessons?status=all", { signal, cache: "no-store" });
      if (!data) throw new HttpError(204, "课时接口没有返回数据");
      setLessons(Array.isArray(data.lessons) ? data.lessons : []);
      setLessonsState("ready");
    } catch (reason) {
      if (isAbortError(reason, signal)) return;
      setLessonsError(errorMessage(reason, "读取课时失败"));
      setLessonsState("error");
    }
  }, []);

  const loadMonthly = useCallback(async (signal: AbortSignal) => {
    setMonthlyState("loading");
    setMonthlyError("");
    try {
      const data = await requestJson<MonthlyResponse>(`/api/finance/monthly?month=${encodeURIComponent(month)}`, { signal, cache: "no-store" });
      if (!data) throw new HttpError(204, "月度核对接口没有返回数据");
      setMonthly(data);
      setMonthlyState("ready");
    } catch (reason) {
      if (isAbortError(reason, signal)) return;
      setMonthlyError(errorMessage(reason, "读取月度核对清单失败"));
      setMonthlyState("error");
    }
  }, [month]);

  const loadContext = useCallback(async (signal: AbortSignal) => {
    if (!lessonId) {
      setContext(null);
      setContextState("idle");
      setContextError("");
      return;
    }
    setContextState("loading");
    setContextError("");
    const query = new URLSearchParams({ lessonId, payerType, payerId });
    try {
      const data = await requestJson<ContextResponse>(`/api/finance/context?${query}`, { signal, cache: "no-store" });
      if (!data) throw new HttpError(204, "规则上下文接口没有返回数据");
      setContext(data);
      setContextState("ready");
    } catch (reason) {
      if (isAbortError(reason, signal)) return;
      setContextError(errorMessage(reason, "读取规则上下文失败"));
      setContextState("error");
    }
  }, [lessonId, payerId, payerType]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setLessonId(params.get("lessonId") || "");
    setStatusFilter(params.get("status") || "");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadFinanceList(controller.signal);
    return () => controller.abort();
  }, [financeRetry, loadFinanceList]);

  useEffect(() => {
    const controller = new AbortController();
    void loadLessons(controller.signal);
    return () => controller.abort();
  }, [lessonsRetry, loadLessons]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMonthly(controller.signal);
    return () => controller.abort();
  }, [monthlyRetry, loadMonthly]);

  useEffect(() => {
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => controller.abort();
  }, [contextRetry, loadContext]);

  useEffect(() => {
    if (!preview?.expiresAt) {
      setPreviewExpired(false);
      return;
    }
    const expiry = Date.parse(preview.expiresAt);
    if (!Number.isFinite(expiry)) {
      setPreviewExpired(true);
      return;
    }
    const remaining = expiry - Date.now();
    if (remaining <= 0) {
      setPreviewExpired(true);
      return;
    }
    setPreviewExpired(false);
    const timer = window.setTimeout(() => setPreviewExpired(true), remaining);
    return () => window.clearTimeout(timer);
  }, [preview?.expiresAt]);

  const clearPreview = () => {
    setPreview(null);
    setPreviewExpired(false);
  };

  const selectLesson = (value: string) => {
    setLessonId(value);
    setPayerId("");
    clearPreview();
    setMessage("");
  };

  const selectPayerType = (value: string) => {
    setPayerType(value);
    setPayerId("");
    clearPreview();
    setMessage("");
  };

  const selectPayer = (value: string) => {
    setPayerId(value);
    clearPreview();
    setMessage("");
  };

  const updateAdjustment = (value: string) => {
    setAdjustment(value);
    clearPreview();
  };

  const updateAdjustmentReason = (value: string) => {
    setAdjustmentReason(value);
    clearPreview();
  };

  const act = async (action: "preview" | "confirm") => {
    if (actionBusy) return;
    if (!lessonId) {
      setMessage("请先选择课时。");
      return;
    }
    if (!payerId) {
      setMessage("请先选择付款方；规则缺失时也必须明确付款方才能生成预览。");
      return;
    }
    if (adjustmentState.error || adjustmentState.value === null) {
      setMessage(adjustmentState.error);
      return;
    }
    if (hasNonZeroAdjustment && !adjustmentReason.trim()) {
      setMessage("手工调整金额非 0 时必须填写调整依据。");
      return;
    }
    if (action === "confirm" && (!preview?.previewToken || previewExpired)) {
      setMessage("预览已过期或不可确认，请重新生成预览。");
      return;
    }
    setActionBusy(action);
    setMessage("");
    const operationId = action === "confirm" ? String(preview?.snapshot?.operationId || "") : createOperationId();
    if (action === "confirm" && !operationId) {
      setActionBusy(null);
      setMessage("预览缺少操作编号，请重新生成预览。");
      return;
    }
    const body = {
      action,
      lessonId: Number(lessonId),
      payerType,
      payerId: Number(payerId),
      adjustment: adjustment.trim(),
      adjustmentReason: adjustmentReason.trim(),
      operationId,
      ...(action === "confirm" ? { previewToken: preview?.previewToken } : {}),
    };
    try {
      const data = await requestJson<PreviewResponse & { id?: number }>("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      if (!data) throw new HttpError(204, "结算接口没有返回数据");
      if (action === "preview") {
        setPreview(data);
        setMessage("预览已生成；尚未写入正式账目，请逐项核对后再确认。");
      } else {
        setMessage("规则、逐项计算和金额快照已由教师确认并入账。");
        clearPreview();
        setFinanceRetry((value) => value + 1);
        setMonthlyRetry((value) => value + 1);
      }
    } catch (reason) {
      setMessage(errorMessage(reason, action === "preview" ? "生成预览失败" : "确认入账失败"));
    } finally {
      setActionBusy(null);
    }
  };

  const currentPreviewExceptions = preview?.context?.exceptions || [];
  const previewCanConfirm = Boolean(preview?.context?.canConfirm && preview.previewToken && !previewExpired);

  return <AppShell title="课时与结算" subtitle="选择课时与付款方 → 读取有效规则 → 生成预览 → 逐项核对 → 最终确认入账" actions={<div className={styles.exportActions}>
    <a className={styles.secondaryButton} href="/api/finance/export?type=institution" aria-label="导出机构结算明细，范围为全部机构课时账目">导出机构明细<span>导出范围：全部机构课时账目</span></a>
    <a className={styles.primaryButton} href={`/api/finance/export?mode=monthly&month=${month}`} aria-label={`导出${month}月度核对表，范围为本月全部非取消课时`}>导出{month}月核对表<span>导出范围：本月全部非取消课时</span></a>
  </div>}>
    <div className={styles.page}>
      {message && <div className={styles.message} role="status">{message}</div>}

      <section className={styles.workflow} aria-label="结算流程">
        <div><p className={styles.eyebrow}>教师确认边界</p><h2>所有金额先停留在预览，确认后才进入正式账目</h2></div>
        <ol className={styles.steps}><li className={styles.stepActive}><b>1</b><span>选择课时与付款方</span></li><li><b>2</b><span>读取有效规则</span></li><li><b>3</b><span>生成预览</span></li><li><b>4</b><span>逐项核对</span></li><li><b>5</b><span>确认入账</span></li></ol>
      </section>

      <section className={styles.metricGrid} aria-label="金额状态概览">
        <article className={styles.metricCard}><span>预计</span><strong>¥{formatMoney(totals?.expected)}</strong><small>服务端返回的预计金额</small></article>
        <article className={styles.metricCard}><span>已收</span><strong>¥{formatMoney(totals?.received)}</strong><small>服务端返回的已收金额</small></article>
        <article className={styles.metricCard}><span>待收</span><strong>¥{formatMoney(totals?.pendingAmount)}</strong><small>状态为待收的差额</small></article>
        <article className={styles.metricCard}><span>少收</span><strong>¥{formatMoney(totals?.underpaidAmount)}</strong><small>服务端标记的少收金额</small></article>
        <article className={styles.metricCard}><span>超收</span><strong>¥{formatMoney(totals?.overpaidAmount)}</strong><small>服务端标记的超收金额</small></article>
        <article className={styles.metricCard}><span>待核对</span><strong>¥{formatMoney(totals?.reviewAmount)}</strong><small>尚未确认的预览金额</small></article>
        <article className={styles.metricCard}><span>异常</span><strong>{formatCount(monthly?.summary?.exceptions)}</strong><small>本月异常课时数量</small></article>
      </section>

      <section className={styles.panel} aria-labelledby="monthly-title">
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>月度核对</p><h2 id="monthly-title">{month} 课时清单</h2><p className={styles.helper}>仅展示本月全部非取消课时；金额缺失会保留为“待生成”，不会用 0 代替。</p></div><label className={styles.compactField}>月份<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label></div>
        {monthlyState === "loading" && !monthly ? <LoadingLine label="月度核对清单" /> : null}
        {monthlyState === "error" ? <ResourceError title="月度清单读取失败" message={monthlyError} onRetry={retryMonthly} /> : null}
        {monthlyState === "ready" && monthly ? <>
          <div className={styles.summaryCounts}><span>课时 <b>{formatCount(monthly.summary?.lessons)}</b></span><span>已完成 <b>{formatCount(monthly.summary?.completed)}</b></span><span>未来未到期 <b>{formatCount(monthly.summary?.future)}</b></span><span>异常 <b>{formatCount(monthly.summary?.exceptions)}</b></span></div>
          {monthly.items?.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>日期</th><th>课时</th><th>生命周期</th><th>规则</th><th>预计</th><th>已收</th><th>差额</th><th>状态/异常</th></tr></thead><tbody>{monthly.items.map((item) => <tr key={item.lessonId} className={item.exceptions?.length ? styles.exceptionRow : undefined}><td>{item.date || "日期待补"}<small>{item.startTime || "时间待补"}</small></td><td>{item.topic || item.courseName || "课时待补"}<small>{item.className || "班级待补"}</small></td><td>{item.lifecycle || "待核对"}</td><td>{item.pricingRuleId ? `规则#${item.pricingRuleId}` : "规则待补"}</td><td>{item.financeId ? `¥${formatMoney(item.expectedAmount)}` : "待生成"}</td><td>{item.financeId ? `¥${formatMoney(item.receivedAmount)}` : "—"}</td><td>{item.financeId ? `¥${formatMoney(item.difference)}` : "—"}</td><td><b>{formatStatus(item.financeStatus)}</b>{item.exceptions?.length ? <small>{item.exceptions.join("；")}</small> : <small>无异常</small>}<button className={styles.inlineButton} type="button" onClick={() => { selectLesson(String(item.lessonId)); setStatusFilter(item.financeStatus || ""); }}>核对此课时</button></td></tr>)}</tbody></table></div> : <EmptyState title="本月暂无非取消课时" description="没有生成虚构的月度金额。" />}
        </> : null}
      </section>

      <section className={styles.panel} aria-labelledby="settlement-title">
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>规则来源与预览</p><h2 id="settlement-title">生成课时结算预览</h2><p className={styles.helper}>预览只读取服务端规则和出勤记录，不写入正式账目。</p></div></div>
        <div className={styles.formGrid}>
          <label>课时<select value={lessonId} onChange={(event) => selectLesson(event.target.value)} disabled={lessonsState === "loading"}><option value="">请选择课时</option>{lessons.map((lesson) => <option value={lesson.id} key={lesson.id}>{lesson.date || "日期待补"} · {lesson.startTime || "时间待补"} · {lesson.topic || lesson.courseName || "课程待补"}</option>)}</select></label>
          <label>付款方类型<select value={payerType} onChange={(event) => selectPayerType(event.target.value)}><option value="institution">机构</option><option value="parent">家长/学生</option></select></label>
          <label>{payerType === "institution" ? "机构" : "学生"}<select value={payerId} onChange={(event) => selectPayer(event.target.value)} disabled={!lessonId || contextState === "loading"}><option value="">请选择{payerType === "institution" ? "机构" : "学生"}</option>{(payerType === "institution" ? context?.institutions : context?.students)?.map((item: any) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>手工调整金额<input inputMode="decimal" type="number" value={adjustment} onChange={(event) => updateAdjustment(event.target.value)} aria-describedby="adjustment-help" /><span id="adjustment-help" className={styles.helper}>无调整请明确输入 0；空白不会自动按 0 发送。</span></label>
          {hasNonZeroAdjustment || adjustmentState.error ? <label className={styles.wide}>调整依据<textarea value={adjustmentReason} onChange={(event) => updateAdjustmentReason(event.target.value)} placeholder="手工调整非 0 时，填写合同、对账单或教师确认依据" aria-required={hasNonZeroAdjustment} /></label> : null}
        </div>
        {lessonsState === "error" ? <ResourceError title="课时列表读取失败" message={lessonsError} onRetry={retryLessons} /> : null}
        {contextState === "error" ? <ResourceError title="规则上下文读取失败" message={contextError} onRetry={retryContext} /> : null}
        {contextState === "loading" && lessonId ? <LoadingLine label="规则来源" /> : null}
        {context?.source ? <div className={styles.sourceCard}><div><b>有效规则 #{context.source.ruleId}</b><span>{context.source.subject || "付款方待补"}</span></div><dl><div><dt>有效期</dt><dd>{context.source.effectiveFrom || "未限定"} 至 {context.source.effectiveTo || "长期有效"}</dd></div><div><dt>底薪</dt><dd>¥{formatMoney(context.source.baseFee)}</dd></div><div><dt>学生单价</dt><dd>¥{formatMoney(context.source.unitFee)}</dd></div></dl></div> : lessonId && payerId && contextState === "ready" ? <div className={styles.warningBox}><b>缺少有效计费规则</b><p>可以生成异常预览，但规则缺失属于阻断异常，不能确认入账。</p></div> : null}
        {context?.exceptions?.length ? <div className={styles.exceptionList} role="alert"><strong>当前异常</strong>{context.exceptions.map((item, index) => <span key={`${item.type}-${index}`}>{item.message || "异常待补"}</span>)}</div> : null}
        <div className={styles.actionRow}><button className={styles.secondaryButton} type="button" disabled={Boolean(actionBusy) || !lessonId || !payerId} onClick={() => void act("preview")}>{actionBusy === "preview" ? "正在生成预览…" : "生成预览（不写账）"}</button>{preview ? <button className={styles.primaryButton} type="button" disabled={Boolean(actionBusy) || !previewCanConfirm} onClick={() => void act("confirm")}>{actionBusy === "confirm" ? "正在确认…" : previewExpired ? "预览已过期，请重做预览" : "确认规则和金额并入账"}</button> : null}</div>
        {preview ? <div className={styles.previewCard} aria-labelledby="preview-title"><div className={styles.previewHeader}><div><p className={styles.eyebrow}>预览快照 · 不写正式账目</p><h3 id="preview-title">逐项计算核对</h3></div><span className={previewExpired ? styles.badgeDanger : styles.badgePending}>{previewExpired ? "已过期" : "待教师确认"}</span></div><div className={styles.previewMeta}><div><b>规则编号</b><span>{preview.context?.source?.ruleId ? `#${preview.context.source.ruleId}` : "规则待补"}</span></div><div><b>有效期</b><span>{preview.context?.source?.effectiveFrom || "未限定"} 至 {preview.context?.source?.effectiveTo || "长期有效"}</span></div><div><b>预览有效期</b><span>{preview.expiresAt ? new Date(preview.expiresAt).toLocaleString("zh-CN") : "待补"}</span></div><div><b>调整金额</b><span>¥{formatMoney(preview.snapshot?.adjustment)}</span></div><div><b>调整原因</b><span>{preview.snapshot?.adjustmentReason || "无手工调整"}</span></div></div><div className={styles.formula}><b>计算公式</b><code>{preview.formula || "服务端未返回计算公式"}</code></div>{currentPreviewExceptions.length ? <div className={styles.exceptionList}><strong>预览异常</strong>{currentPreviewExceptions.map((item, index) => <span key={`${item.type}-${index}`}>{item.message || "异常待补"}</span>)}</div> : <p className={styles.successLine}>预览未返回阻断异常，但仍需教师逐项核对后确认。</p>}<div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>学生</th><th>出勤状态</th><th>计费系数</th><th>单价</th><th>金额</th><th>计算说明</th></tr></thead><tbody>{preview.preview?.items?.length ? preview.preview.items.map((item: any) => <tr key={item.studentId}><td>学生#{item.studentId}</td><td>{item.status || "待补"}</td><td>{item.factor ?? "—"}</td><td>¥{formatMoney(item.unitFee)}</td><td>¥{formatMoney(item.amount)}</td><td>{item.reason || "服务端未返回说明"}</td></tr>) : <tr><td colSpan={6}>服务端未返回逐项计算，不能确认入账。</td></tr>}</tbody></table></div></div> : null}
      </section>

      <section className={styles.panel} aria-labelledby="ledger-title">
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>正式账目</p><h2 id="ledger-title">课时账目</h2><p className={styles.helper}>只展示服务端已保存的金额；待核对记录不是已确认账目。</p></div><div className={styles.filterRow}><label>状态<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option><option value="review">待核对</option><option value="pending">待收</option><option value="settled">已收清</option><option value="underpaid">少收</option><option value="overpaid">超收</option></select></label><button className={styles.secondaryButton} type="button" onClick={() => { setLessonId(""); setStatusFilter(""); clearPreview(); }}>清空筛选</button></div></div>
        {financeState === "loading" && !items.length ? <LoadingLine label="课时账目" /> : null}
        {financeState === "error" ? <ResourceError title="课时账目读取失败" message={financeError} onRetry={retryFinance} /> : null}
        {financeState === "ready" && items.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>日期</th><th>课程</th><th>规则来源</th><th>预计</th><th>已收</th><th>状态</th></tr></thead><tbody>{items.map((item) => <tr key={item.id || item.lessonId}><td>{item.date || "日期待补"}<small>{item.startTime || "时间待补"}</small></td><td>{item.topic || item.courseName || "课程待补"}<small>{item.location || "地点待补"}</small></td><td>{item.pricingRuleId ? `规则#${item.pricingRuleId}` : "待补"}</td><td>¥{formatMoney(item.expectedAmount ?? item.expected_amount)}</td><td>¥{formatMoney(item.receivedAmount ?? item.received_amount)}</td><td><b>{formatStatus(item.status)}</b>{item.difference !== undefined && item.difference !== null ? <small>差额 ¥{formatMoney(item.difference)}</small> : null}</td></tr>)}</tbody></table></div> : financeState === "ready" ? <EmptyState title="暂无符合条件的结算记录" description="完成课时后先生成预览，教师确认后才进入正式账目。" /> : null}
      </section>
    </div>
  </AppShell>;
}
