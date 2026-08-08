"use client";

import Link from "@/app/components/HardNavigationLink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useSessionState } from "../components/SessionProvider";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../components/ui/Primitives";
import { HttpError, requestJson } from "../lib/http-client";

type ClassRow = {
  id: number;
  name: string;
  stage: string;
  grade: string;
  courseType?: string;
  startDate?: string;
  schedule?: string;
  notes?: string;
  status?: string;
  studentCount?: number;
  lessonCount?: number;
  riskCount?: number;
};

type ClassForm = ReturnType<typeof blank>;

function blank() {
  return {
    name: "",
    stage: "高中",
    grade: "高一",
    courseType: "小班课",
    startDate: "",
    schedule: "",
    notes: "",
    status: "active",
  };
}

function formFromRow(row?: ClassRow): ClassForm {
  if (!row) return blank();
  return {
    name: row.name,
    stage: row.stage,
    grade: row.grade,
    courseType: row.courseType || "",
    startDate: row.startDate || "",
    schedule: row.schedule || "",
    notes: row.notes || "",
    status: row.status || "active",
  };
}

function failureMessage(reason: unknown, fallback: string) {
  return reason instanceof HttpError || reason instanceof Error
    ? reason.message
    : fallback;
}

export default function ClassesPage() {
  const { session } = useSessionState();
  const canWrite = session.role === "teacher";
  const [rows, setRows] = useState<ClassRow[]>([]);
  const [filter, setFilter] = useState("active");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [classLoadError, setClassLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<ClassForm>(blank);
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [formBaseline, setFormBaseline] = useState(JSON.stringify(blank()));
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const formDirty = open && JSON.stringify(form) !== formBaseline;

  useEffect(() => {
    busyRef.current = busy;
    dirtyRef.current = formDirty;
  }, [busy, formDirty]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setClassLoadError("");
    try {
      const params = new URLSearchParams({
        status: filter,
        q: query,
        page: String(page),
      });
      const data = await requestJson<{
        classes?: ClassRow[];
        total?: number;
        page?: number;
        pageCount?: number;
      }>(
        `/api/classes?${params.toString()}`,
        { signal },
      );
      if (!data) throw new HttpError(200, "班级列表响应为空，请重试");
      setRows(data.classes || []);
      setTotal(Number(data.total || 0));
      setPageCount(Math.max(1, Number(data.pageCount || 1)));
      if (typeof data.page === "number" && data.page !== page) setPage(data.page);
    } catch (reason) {
      if (!signal?.aborted) {
        setRows([]);
        setTotal(0);
        setClassLoadError(failureMessage(reason, "暂时无法读取班级"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filter, page, query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openEditor = (row?: ClassRow) => {
    if (!canWrite || busy || actionBusy) return;
    const next = formFromRow(row);
    setFormBaseline(JSON.stringify(next));
    setForm(next);
    setEditing(row?.id || null);
    setFormError("");
    setOpen(true);
  };

  const dismissEditor = useCallback(() => {
    if (busyRef.current) return;
    if (dirtyRef.current && !window.confirm("班级信息尚未保存，确定放弃当前修改吗？")) return;
    setOpen(false);
    setEditing(null);
    setForm(blank());
    setFormError("");
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector =
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[href]";
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
    (dialog.querySelector<HTMLElement>("input:not(:disabled)") || focusable[0] || dialog).focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissEditor();
        return;
      }
      if (event.key !== "Tab") return;
      const current = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dismissEditor, open]);

  useEffect(() => {
    if (!open) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [open]);

  const save = async () => {
    if (busy) return;
    const name = form.name.trim();
    if (!name || !form.stage.trim() || !form.grade.trim()) {
      setFormError("请填写班级名称、学段和年级");
      return;
    }
    if (name.length > 80) {
      setFormError("班级名称不超过 80 个字符");
      return;
    }
    setBusy(true);
    setFormError("");
    setMessage("");
    try {
      const data = await requestJson<{ class?: ClassRow }>(
        editing ? `/api/classes/${editing}` : "/api/classes",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, name }),
        },
      );
      if (!data?.class) throw new HttpError(200, "班级保存响应为空，请重试");
      setFormBaseline(JSON.stringify(form));
      setOpen(false);
      setEditing(null);
      setForm(blank());
      setMessage(form.status === "archived" ? "班级信息已保存" : "班级已保存");
      await load();
    } catch (reason) {
      setFormError(failureMessage(reason, "保存班级失败"));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (row: ClassRow) => {
    if (busy || actionBusy) return;
    const nextStatus = row.status === "archived" ? "active" : "archived";
    const actionLabel = nextStatus === "archived" ? "归档" : "恢复";
    if (!window.confirm(`确认${actionLabel}“${row.name}”？归档不会删除历史课时和学生记录。`)) return;
    setActionBusy(row.id);
    setMessage("");
    try {
      const data = await requestJson<{ class?: ClassRow }>(`/api/classes/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!data?.class) throw new HttpError(200, "班级状态响应为空，请重试");
      setMessage(nextStatus === "archived" ? "班级已归档" : "班级已恢复");
      await load();
    } catch (reason) {
      setMessage(failureMessage(reason, `${actionLabel}班级失败`));
    } finally {
      setActionBusy(null);
    }
  };

  const totals = useMemo(() => rows.reduce(
    (sum, row) => ({
      students: sum.students + Number(row.studentCount || 0),
      lessons: sum.lessons + Number(row.lessonCount || 0),
      risks: sum.risks + Number(row.riskCount || 0),
    }),
    { students: 0, lessons: 0, risks: 0 },
  ), [rows]);

  return (
    <AppShell
      title="学生与班级"
      subtitle="先看班级运行状态，再进入学生成长档案"
      actions={canWrite ? (
        <div className="classOverviewHeaderActions">
          <Link className="zs-button zs-button--secondary" href="/students?new=1">录入学生</Link>
          <Button onClick={() => openEditor()}>新建班级</Button>
        </div>
      ) : undefined}
    >
      <div className="classOverviewPage">
        {message && <div className="classOverviewNotice" role="status">{message}</div>}

        <nav className="classRosterRail" aria-label="班级与学生视图">
          <button
            aria-current={filter === "active" ? "page" : undefined}
            className={filter === "active" ? "isActive" : ""}
            onClick={() => {
              setFilter("active");
              setPage(1);
            }}
          >
            <span>当前点名册</span>
            <b>进行中班级</b>
          </button>
          <button
            aria-current={filter === "archived" ? "page" : undefined}
            className={filter === "archived" ? "isActive" : ""}
            onClick={() => {
              setFilter("archived");
              setPage(1);
            }}
          >
            <span>历史留档</span>
            <b>已归档班级</b>
          </button>
          <Link href="/students"><span>个人成长</span><b>学生档案</b></Link>
        </nav>

        <form
          className="classOverviewSearch"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(searchInput.trim());
            setPage(1);
          }}
        >
          <label htmlFor="class-overview-search">搜索班级</label>
          <input
            id="class-overview-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="班级名称、学段或年级"
          />
          <Button type="submit" disabled={loading}>搜索</Button>
          {query ? (
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => {
                setQuery("");
                setSearchInput("");
                setPage(1);
              }}
            >
              清除搜索
            </Button>
          ) : null}
        </form>

        <div className="classOverviewMetrics">
          <MetricCard label={filter === "active" ? "进行中班级" : "已归档班级"} value={total} detail="当前筛选范围" />
          <MetricCard label="在班学生" value={totals.students} detail="仅统计有效班级关系" />
          <MetricCard label="累计课时" value={totals.lessons} detail="当前列表内的课时记录" />
          <MetricCard label="教师确认关注" value={totals.risks} detail="有明确课堂记录的学生" />
        </div>

        {classLoadError ? (
          <div className="classOverviewError" role="alert">
            <div><strong>班级列表暂时无法读取</strong><p>{classLoadError}</p></div>
            <Button variant="secondary" onClick={() => void load()}>重新读取班级</Button>
          </div>
        ) : loading ? (
          <div className="classOverviewLoading" role="status">正在整理班级点名册…</div>
        ) : (
          <Panel
            className="classOverviewPanel"
            eyebrow={filter === "active" ? "今日教学范围" : "历史教学档案"}
            title={filter === "active" ? "进行中的教学班级" : "已归档班级"}
            description={filter === "active" ? "学生、课时和关注数据均来自已保存记录。" : "归档只停止日常入口，不删除课时、学生或反馈历史。"}
          >
            {rows.length === 0 ? (
              <EmptyState
                title={filter === "archived" ? "还没有归档班级" : "还没有班级"}
                description={filter === "archived" ? "归档的班级会保留完整历史记录，必要时可以恢复。" : "创建班级后，可添加学生、安排课时并查看真实教学记录。"}
                action={filter === "active" && canWrite ? <Button variant="secondary" onClick={() => openEditor()}>创建第一个班级</Button> : undefined}
              />
            ) : (
              <div className="classOverviewGrid">
                {rows.map((row) => {
                  const archived = row.status === "archived";
                  return (
                    <article className="classOverviewCard" key={row.id}>
                      <header>
                        <StatusBadge tone={archived ? "neutral" : "success"}>{archived ? "已归档" : "进行中"}</StatusBadge>
                        <span>{row.stage} · {row.grade}</span>
                      </header>
                      <div className="classOverviewCardTitle">
                        <h3>{row.name}</h3>
                        <p>{row.courseType || "未设置课程类型"}</p>
                      </div>
                      <p className="classOverviewSchedule">{row.schedule || "尚未设置固定上课时间"}</p>
                      <dl>
                        <div><dt>学生</dt><dd>{row.studentCount || 0}</dd></div>
                        <div><dt>课时</dt><dd>{row.lessonCount || 0}</dd></div>
                        <div className={Number(row.riskCount || 0) > 0 ? "hasRisk" : ""}><dt>需关注</dt><dd>{row.riskCount || 0}</dd></div>
                      </dl>
                      <footer>
                        <Link className="zs-button zs-button--primary" href={`/classes/${row.id}`}>查看班级</Link>
                        {canWrite && <Button variant="secondary" disabled={Boolean(actionBusy)} onClick={() => openEditor(row)}>编辑</Button>}
                        {canWrite && <Button variant={archived ? "quiet" : "danger"} disabled={Boolean(actionBusy)} onClick={() => void archive(row)}>{actionBusy === row.id ? "正在处理…" : archived ? "恢复" : "归档"}</Button>}
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}
            {!loading && !classLoadError && rows.length > 0 ? (
              <div className="classOverviewPagination" aria-live="polite">
                <span>第 {page} / {pageCount} 页</span>
                <div>
                  <Button
                    variant="secondary"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    aria-label="上一页班级"
                  >
                    上一页
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={loading || page >= pageCount}
                    onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                    aria-label="下一页班级"
                  >
                    下一页
                  </Button>
                </div>
              </div>
            ) : null}
          </Panel>
        )}
      </div>

      {open && (
        <div className="modalBackdrop classOverviewBackdrop" role="presentation">
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="lessonModal classOverviewDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="class-dialog-title"
          >
            <div className="modalTitle">
              <div><p>{editing ? "编辑班级" : "新建班级"}</p><h2 id="class-dialog-title">{editing ? "调整班级信息" : "建立一个教学班级"}</h2></div>
              <button aria-label="关闭" disabled={busy} onClick={dismissEditor}>×</button>
            </div>
            {formError && <div className="classOverviewFormError" role="alert">{formError}</div>}
            <form className="classOverviewForm" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label className="isWide">班级名称<input autoComplete="off" maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>学段<select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}><option>初中</option><option>高中</option></select></label>
              <label>年级<input value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} /></label>
              <label>课程类型<input value={form.courseType} onChange={(event) => setForm({ ...form, courseType: event.target.value })} placeholder="如：一对一、小班课" /></label>
              <label>开课日期<input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
              <label className="isWide">固定上课时间<input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="如：每周六 14:00–16:00" /></label>
              <label className="isWide">备注<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
              <div className="classOverviewDialogActions">
                <span className={formDirty ? "isDirty" : ""}>{formDirty ? "有未保存修改" : "信息已同步"}</span>
                <Button type="button" variant="secondary" disabled={busy} onClick={dismissEditor}>取消</Button>
                <Button type="submit" disabled={busy}>{busy ? "正在保存…" : "保存班级"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
