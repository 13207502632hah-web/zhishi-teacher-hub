"use client";

import Link from "@/app/components/HardNavigationLink";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { AppShell } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import { BRAND_NAME, BRAND_SUBJECT, TEACHER_DISPLAY_NAME } from "../lib/brand";
import styles from "./resources.module.css";

type Resource = {
  id: number;
  title: string;
  type?: string | null;
  tags?: string | null;
  url?: string | null;
  content?: string | null;
  sourceRef?: string | null;
  visibility?: string | null;
};

type ResourceList = {
  resources: Resource[];
  canWrite: boolean;
};

type ResourceForm = {
  title: string;
  type: string;
  tags: string;
  url: string;
  content: string;
  visibility: "private" | "public";
};

type ListStatus = "loading" | "ready" | "permission" | "error";
type NoticeTone = "success" | "error" | "info";

type Notice = {
  tone: NoticeTone;
  text: string;
};

const makeBlankForm = (): ResourceForm => ({
  title: "",
  type: "备课素材",
  tags: "",
  url: "",
  content: "",
  visibility: "private",
});

const safeProtocols = ["http:", "https:"];

function safeExternalUrl(value: string | null | undefined) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return safeProtocols.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof HttpError ? error.message : fallback;
}

function isPermissionError(error: unknown) {
  return error instanceof HttpError && [401, 403].includes(error.status);
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function matchesQuery(resource: Resource, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [resource.title, resource.tags, resource.content, resource.type]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase().includes(needle));
}

export default function ResourcesPage() {
  const [rows, setRows] = useState<Resource[]>([]);
  const [draftQuery, setDraftQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [searchRequestKey, setSearchRequestKey] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listError, setListError] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ResourceForm>(makeBlankForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const savingRef = useRef(false);
  const deletingRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const isDirty = Boolean(
    form.title ||
      form.tags ||
      form.url ||
      form.content ||
      form.type !== "备课素材" ||
      form.visibility !== "private",
  );

  const loadResources = useCallback(async (query: string, signal: AbortSignal) => {
    setListStatus("loading");
    setListError("");
    try {
      const payload = await requestJson<ResourceList>(`/api/resources?q=${encodeURIComponent(query)}`, { signal });
      if (!payload || !Array.isArray(payload.resources)) throw new HttpError(200, "资源中心返回了无法识别的数据");
      setRows(payload.resources);
      setCanWrite(Boolean(payload.canWrite));
      setListStatus("ready");
    } catch (error) {
      if (isAborted(error, signal)) return;
      if (isPermissionError(error)) {
        setListStatus("permission");
        setListError(errorMessage(error, "当前账号没有访问资源中心的权限"));
      } else {
        setListStatus("error");
        setListError(errorMessage(error, "资源中心暂时无法读取，请稍后重试"));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadResources(appliedQuery, controller.signal);
    return () => controller.abort();
  }, [appliedQuery, loadResources, retryKey, searchRequestKey]);

  const submitSearch = useCallback((event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setAppliedQuery(draftQuery.trim());
    setSearchRequestKey((value) => value + 1);
  }, [draftQuery]);

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitSearch();
  };

  const openModal = () => {
    setFormError("");
    setNotice(null);
    setOpen(true);
  };

  const closeModal = useCallback((discard = false) => {
    if (!discard && isDirty && !window.confirm("有未保存修改，确定关闭并放弃这些内容吗？")) return;
    setOpen(false);
    setFormError("");
    if (discard) setForm(makeBlankForm());
  }, [isDirty]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) previousFocusRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }

    wasOpenRef.current = true;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => firstFieldRef.current?.focus(), 0);
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]") || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleDialogKeyDown);
    };
  }, [closeModal, open]);

  useEffect(() => {
    if (!open || !isDirty) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [isDirty, open]);

  const updateForm = <K extends keyof ResourceForm>(field: K, value: ResourceForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError("");
  };

  const saveResource = async () => {
    if (savingRef.current) return;
    const title = form.title.trim();
    const url = form.url.trim();
    if (!title) {
      setFormError("保存失败：请填写资源名称");
      return;
    }
    if (url && !safeExternalUrl(url)) {
      setFormError("保存失败：外部链接仅支持 http:// 或 https:// 安全协议");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      const payload = await requestJson<{ resource?: Resource }>("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, title, url }),
      });
      if (!payload?.resource) throw new HttpError(200, "服务器没有返回已保存的资源");
      const resource = payload.resource;
      setRows((current) => matchesQuery(resource, appliedQuery) ? [resource, ...current.filter((item) => item.id !== resource.id)] : current);
      setNotice({ tone: "success", text: "资源已保存；公开范围仍由服务端权限规则控制。" });
      closeModal(true);
    } catch (error) {
      setFormError(isPermissionError(error) ? "保存失败：当前账号没有资源管理权限，请刷新后重试。" : `保存失败：${errorMessage(error, "服务器暂时无法保存，请稍后重试")}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deleteResource = async (resource: Resource) => {
    if (deletingRef.current !== null) return;
    if (!window.confirm(`危险操作：确定删除“${resource.title}”吗？删除后不可恢复。`)) return;
    deletingRef.current = resource.id;
    setDeletingId(resource.id);
    setNotice(null);
    try {
      const payload = await requestJson<{ ok?: boolean }>(`/api/resources/${resource.id}`, { method: "DELETE" });
      if (!payload?.ok) throw new HttpError(200, "服务器没有确认删除结果");
      setRows((current) => current.filter((item) => item.id !== resource.id));
      setNotice({ tone: "success", text: "资源已删除。" });
    } catch (error) {
      setNotice({ tone: "error", text: `删除失败：${errorMessage(error, "服务器暂时无法删除，请稍后重试")}` });
    } finally {
      deletingRef.current = null;
      setDeletingId(null);
    }
  };

  const printResource = async (resource: Resource) => {
    if (printingId !== null) return;
    setPrintingId(resource.id);
    setNotice(null);
    try {
      const payload = await requestJson<{ ok?: boolean }>("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "print", entityType: "resource", entityId: resource.id }),
      });
      if (!payload?.ok) throw new HttpError(200, "审计接口没有确认本次打印");
      window.print();
      setNotice({ tone: "success", text: "打印审计已记录，可以继续使用系统打印对话框。" });
    } catch (error) {
      setNotice({ tone: "error", text: `审计记录失败，未开始打印：${errorMessage(error, "请稍后重试")}` });
    } finally {
      setPrintingId(null);
    }
  };

  const renderStatus = () => {
    if (listStatus === "loading") return <div className={styles.statePanel} role="status"><strong>正在读取公开资源</strong><span>正在按当前搜索条件读取；不会因为键入单个字符而自动请求。</span></div>;
    if (listStatus === "permission") return <div className={`${styles.statePanel} ${styles.stateError}`} role="alert"><strong>资源中心权限不足</strong><span>{listError || "当前账号没有访问私人资源的权限；公开资源仍可由访客浏览。"}</span><div className={styles.stateActions}><Link className={styles.secondaryButton} href="/teacher-login?return_to=%2Fresources">教师管理员登录</Link><button type="button" className={styles.textButton} onClick={() => setRetryKey((value) => value + 1)}>重新读取</button></div></div>;
    if (listStatus === "error") return <div className={`${styles.statePanel} ${styles.stateError}`} role="alert"><strong>资源中心暂时无法读取</strong><span>{listError || "服务器暂时无法读取资源，请稍后重试。不会把错误当作空数据。"}</span><div className={styles.stateActions}><button type="button" className={styles.secondaryButton} onClick={() => setRetryKey((value) => value + 1)}>重新读取</button></div></div>;
    if (!rows.length) return <div className={styles.emptyState}><span className={styles.emptyIcon} aria-hidden="true">⌕</span><h3>{canWrite ? "还没有个人资源" : "暂无公开资源"}</h3><p>{canWrite ? "还没有个人资源；可以添加备课素材或从教学反思沉淀策略。这里不会填充虚构资源。" : "还没有公开资源；教师发布不含学生、家长或私人教学信息的内容后，匿名访客才会看到。"}</p>{canWrite && <button type="button" className={styles.secondaryButton} onClick={openModal}>添加第一份资源</button>}</div>;
    return null;
  };

  return <AppShell title="资源中心" subtitle="公开检索入口；私人教学资料仅在教师与助教权限内可见" actions={canWrite ? <button type="button" className={styles.primaryButton} onClick={openModal}>＋ 添加资源</button> : undefined}>
    <div className={styles.page}>
      {notice && <div className={notice.tone === "error" ? styles.noticeError : notice.tone === "success" ? styles.noticeSuccess : styles.noticeInfo} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}

      <section className={styles.hero} aria-labelledby="resource-intro-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>{BRAND_NAME} · 备课灵感库 · 资源检索</p>
          <h2 id="resource-intro-title">让教学准备更有据可查。</h2>
          <p>这里独立收纳{BRAND_SUBJECT}教学资源、课堂活动和可复用方法。公开内容供访客检索；班级、学生、课时和反馈仍保存在私人教师工作台。</p>
          <div className={styles.heroTags}><span>初中 / 高中</span><span>题库导入</span><span>私密优先</span></div>
        </div>
        <div className={styles.shortcutGrid} aria-label="教师工作台入口">
          <Link className={styles.shortcut} href="/workspace"><strong>教师工作台</strong><span>登录后使用 · 管理课时、学生、题库和反馈</span></Link>
          <Link className={styles.shortcut} href="/questions?import=1"><strong>题库导入</strong><span>登录后使用 · Word 识别预览与逐题校对</span></Link>
          <Link className={styles.shortcut} href="/papers"><strong>专业组卷</strong><span>登录后使用 · 按知识点、题型、难度组合</span></Link>
          <Link className={styles.shortcut} href="/reflections"><strong>教学策略</strong><span>登录后使用 · 从真实教学反思沉淀</span></Link>
        </div>
      </section>

      <section className={styles.searchSection} aria-labelledby="resource-search-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>公开资源中心</p><h2 id="resource-search-title">先检索，再决定是否登录管理</h2></div><span>搜索只在点击“搜索”或按 Enter 后提交</span></div>
        <form className={styles.searchForm} onSubmit={submitSearch}>
          <label className={styles.searchField}><span>搜索资源名称、标签或内容</span><input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} onKeyDown={handleSearchKeyDown} placeholder="例如：课堂活动、依法治国" aria-label="搜索资源" /></label>
          <button type="submit" className={styles.primaryButton} disabled={listStatus === "loading"}>搜索</button>
        </form>
        <div className={styles.boundaryHint} role="note"><strong>权限边界</strong><span>匿名访客只会看到公开资源；教师和助教能否查看、添加或删除私人资源，仍由服务端权限核验。公开前不得包含学生、家长或私人教学信息。</span></div>
      </section>

      <section className={styles.resourceSection} aria-labelledby="resource-list-title">
        <header className={styles.sectionHeading}><div><p className={styles.eyebrow}>检索结果</p><h2 id="resource-list-title">公开资源与我的资料</h2></div>{canWrite && <button type="button" className={styles.secondaryButton} onClick={openModal}>添加资源</button>}</header>
        {renderStatus()}
        {listStatus === "ready" && rows.length > 0 && <div className={styles.resourceGrid}>{rows.map((item) => {
          const externalUrl = safeExternalUrl(item.url);
          return <article className={styles.resourceCard} key={item.id}>
            <div className={styles.cardMeta}><span className={styles.badge}>{item.type || "资源"}</span>{item.sourceRef?.startsWith("reflection:") && <span className={styles.badgeMuted}>来自教学反思</span>}{canWrite && <span className={styles.visibilityBadge}>{item.visibility === "public" ? "公开" : "仅教师与助教"}</span>}</div>
            <h3>{item.title}</h3>
            <p className={styles.cardContent}>{item.content || "暂无内容说明"}</p>
            <p className={styles.cardTags}>{item.tags || "未设置标签"}</p>
            {item.url && !externalUrl && <p className={styles.linkWarning} role="note">链接未显示：仅支持 http:// 或 https:// 安全协议。</p>}
            <div className={styles.cardActions}>
              {externalUrl && <a className={styles.textButton} href={externalUrl} target="_blank" rel="noopener noreferrer">打开安全链接</a>}
              {canWrite && <button type="button" className={styles.textButton} disabled={printingId !== null} onClick={() => void printResource(item)}>{printingId === item.id ? "记录审计…" : "打印"}</button>}
              {canWrite && <button type="button" className={styles.dangerButton} disabled={deletingId !== null} onClick={() => void deleteResource(item)}>{deletingId === item.id ? "删除中…" : "删除"}</button>}
            </div>
          </article>;
        })}</div>}
      </section>

      <section className={styles.methodSection} id="teaching-method" aria-labelledby="teaching-method-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{TEACHER_DISPLAY_NAME}的教学方法</p><h2 id="teaching-method-title">保留方法说明，把重点放回资源检索</h2></div><span>资料边界先于分享速度</span></div>
        <div className={styles.methodGrid}><Link href="/classes"><strong>01 · 建立班级与学生</strong><span>必要的学习信息留在私人工作台，联系方式不在公开资源中展示。</span></Link><Link href="/lessons?new=1"><strong>02 · 记录一节真实课时</strong><span>目标、重难点、课堂活动和课后表现分开记录，方便后续检索。</span></Link><Link href="/questions?import=1"><strong>03 · 导入并校对试题</strong><span>答案版 Word 先进入待校对区，核对题干、答案、解析和知识点。</span></Link><Link href="/reflections?new=1"><strong>04 · 复盘并沉淀策略</strong><span>只把确认过的有效做法整理为资源，下一次备课再复用。</span></Link></div>
      </section>

      <section className={styles.boundarySection} aria-labelledby="resource-boundary-title">
        <div><p className={styles.eyebrow}>外部资源连接</p><h2 id="resource-boundary-title">能保存链接，不替你绕过授权</h2><p>可保存自己有权访问的夸克网盘、WPS 或学校教研平台链接；打开会进入新标签页。系统不会绕过登录、付费、下载券或验证码，也不会自动抓取未授权页面。</p></div>
        <div className={styles.boundaryList}><div><strong>公开前检查</strong><span>不包含学生、家长、联系方式、评价、个别反馈或其他私人教学信息。</span></div><div><strong>本地导入</strong><span>自己有权使用的 .docx 先下载，再从 Word 导入并人工校对。</span></div><Link className={styles.secondaryButton} href="/questions?import=1">查看导入步骤 →</Link></div>
      </section>
    </div>

    {canWrite && open && <ResourceDialog dialogRef={dialogRef} firstFieldRef={firstFieldRef} form={form} formError={formError} isDirty={isDirty} saving={saving} onChange={updateForm} onClose={() => closeModal()} onSave={() => void saveResource()} />}
  </AppShell>;
}

type ResourceDialogProps = {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
  form: ResourceForm;
  formError: string;
  isDirty: boolean;
  saving: boolean;
  onChange: <K extends keyof ResourceForm>(field: K, value: ResourceForm[K]) => void;
  onClose: () => void;
  onSave: () => void;
};

function ResourceDialog({ dialogRef, firstFieldRef, form, formError, isDirty, saving, onChange, onClose, onSave }: ResourceDialogProps) {
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.dialog} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="resource-dialog-title" aria-describedby="resource-dialog-description">
      <header className={styles.dialogHeader}><div><p className={styles.eyebrow}>教师资源管理</p><h2 id="resource-dialog-title">添加资源</h2></div><button type="button" className={styles.closeButton} aria-label="关闭添加资源弹窗" onClick={onClose}>×</button></header>
      <p id="resource-dialog-description" className={styles.dialogDescription}>资源保存后仍会由服务端核验权限；关闭、ESC 或刷新前会保护未保存内容。</p>
      <form className={styles.dialogForm} onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label className={styles.fieldWide}>资源名称<input ref={firstFieldRef} value={form.title} onChange={(event) => onChange("title", event.target.value)} aria-invalid={Boolean(formError)} /></label>
        <label>类型<select value={form.type} onChange={(event) => onChange("type", event.target.value)}><option>备课素材</option><option>课堂活动</option><option>教学策略</option><option>规范话术</option><option>其他</option></select></label>
        <label>可见范围<select value={form.visibility} onChange={(event) => onChange("visibility", event.target.value as ResourceForm["visibility"])}><option value="private">仅教师与助教</option><option value="public">公开给访客（仅适合不含学生、家长或私人教学信息）</option></select></label>
        <label className={styles.fieldWide}>标签<input value={form.tags} onChange={(event) => onChange("tags", event.target.value)} placeholder="逗号分隔" /></label>
        <label className={styles.fieldWide}>外部链接（可选，仅 http:// 或 https://）<input type="url" value={form.url} onChange={(event) => onChange("url", event.target.value)} placeholder="https://example.com/resource" /></label>
        <label className={styles.fieldWide}>内容说明<textarea rows={6} value={form.content} onChange={(event) => onChange("content", event.target.value)} /></label>
        {form.visibility === "public" && <div className={styles.publicWarning} role="alert"><strong>公开前请确认</strong><span>不得包含学生、家长或私人教学信息；联系方式、评价、个别反馈和可识别课堂记录必须保持“仅教师与助教”。</span></div>}
        {formError && <div className={styles.formError} role="alert">{formError}</div>}
        <footer className={styles.dialogActions}><button type="button" className={styles.secondaryButton} disabled={saving} onClick={onClose}>取消</button><button type="submit" className={styles.primaryButton} disabled={saving || !isDirty}>{saving ? "保存中…" : "保存资源"}</button></footer>
      </form>
    </div>
  </div>;
}
