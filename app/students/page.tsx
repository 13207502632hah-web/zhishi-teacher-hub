"use client";

import Link from "@/app/components/HardNavigationLink";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppShell } from "../components/AppShell";
import { useSessionState } from "../components/SessionProvider";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../components/ui/Primitives";
import { personInitial } from "../lib/display-format";
import { HttpError, requestJson } from "../lib/http-client";

type AttentionReason = {
  evidence: string;
  label: string;
  level?: number;
};

type Student = {
  classNames?: string;
  examGoal?: string;
  foundationLevel?: string;
  grade: string;
  id: number;
  name: string;
  nickname?: string;
  reasons?: AttentionReason[];
  riskConfirmed?: boolean | number;
  riskTags?: string;
  school?: string;
  severity?: number;
  stageGoal?: string;
  status?: string;
  textbookVersion?: string;
  weakKnowledge?: string;
};

type ClassRow = {
  id: number;
  name: string;
};

type StudentFilters = {
  classId: string;
  grade: string;
  q: string;
  risk: string;
};

type AttentionRange = {
  start: string;
  today: string;
};

const grades = ["七年级", "八年级", "九年级", "高一", "高二", "高三"];

const emptyFilters = (): StudentFilters => ({
  classId: "",
  grade: "",
  q: "",
  risk: "",
});

const blank = () => ({
  classId: "",
  examGoal: "",
  foundationLevel: "",
  grade: "高一",
  guardianContact: "",
  learningHabits: "",
  name: "",
  nickname: "",
  notes: "",
  riskConfirmed: "false",
  riskTags: "",
  school: "",
  stageGoal: "",
  strengths: "",
  subjectChoice: "",
  textbookVersion: "统编版",
  weakKnowledge: "",
});

type StudentForm = ReturnType<typeof blank>;

function failureMessage(reason: unknown, fallback: string) {
  return reason instanceof HttpError || reason instanceof Error
    ? reason.message
    : fallback;
}

function displayDate(value?: string) {
  if (!value) return "尚未形成统计区间";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}.${month}.${day}` : value;
}

export default function StudentsPage() {
  const { session } = useSessionState();
  const canWrite = session.role === "teacher";
  const [rows, setRows] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [attentionMode, setAttentionMode] = useState(false);
  const [attentionRange, setAttentionRange] = useState<AttentionRange | null>(null);
  const [attentionRules, setAttentionRules] = useState<string[]>([]);
  const [draftFilters, setDraftFilters] = useState<StudentFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<StudentFilters>(emptyFilters);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [studentLoadError, setStudentLoadError] = useState("");
  const [classLoading, setClassLoading] = useState(true);
  const [classLoadError, setClassLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StudentForm>(blank);
  const [formBaseline, setFormBaseline] = useState(JSON.stringify(blank()));
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const saveBusyRef = useRef(false);
  const dirtyRef = useRef(false);
  const formDirty = open && JSON.stringify(form) !== formBaseline;

  useEffect(() => {
    saveBusyRef.current = saveBusy;
    dirtyRef.current = formDirty;
  }, [formDirty, saveBusy]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialFilters = {
      ...emptyFilters(),
      classId: params.get("classId") || "",
      grade: params.get("grade") || "",
      q: params.get("q") || "",
      risk: params.get("risk") || "",
    };
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setAttentionMode(params.get("attention") === "weekly");
    if (params.get("new") === "1" && canWrite) {
      const next = blank();
      setForm(next);
      setFormBaseline(JSON.stringify(next));
      setOpen(true);
    }
    setInitialized(true);
  }, [canWrite]);

  const loadStudents = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setStudentLoadError("");
    try {
      const query = new URLSearchParams({
        classId: appliedFilters.classId,
        grade: appliedFilters.grade,
        q: appliedFilters.q,
        risk: appliedFilters.risk,
      });
      const endpoint = attentionMode
        ? "/api/students/attention"
        : `/api/students?${query.toString()}`;
      const data = await requestJson<{
        range?: AttentionRange;
        rules?: string[];
        students?: Student[];
      }>(endpoint, { signal });
      if (!data) throw new HttpError(200, "学生列表响应为空，请重试");
      setRows(data.students || []);
      setAttentionRange(attentionMode ? data.range || null : null);
      setAttentionRules(attentionMode ? data.rules || [] : []);
    } catch (reason) {
      if (!signal?.aborted) {
        setRows([]);
        setStudentLoadError(failureMessage(reason, "暂时无法读取学生档案"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [appliedFilters, attentionMode]);

  const loadClasses = useCallback(async (signal?: AbortSignal) => {
    setClassLoading(true);
    setClassLoadError("");
    try {
      const data = await requestJson<{ classes?: ClassRow[] }>(
        "/api/classes?status=active",
        { signal },
      );
      if (!data) throw new HttpError(200, "班级选项响应为空，请重试");
      setClasses(data.classes || []);
    } catch (reason) {
      if (!signal?.aborted) {
        setClasses([]);
        setClassLoadError(failureMessage(reason, "暂时无法读取班级选项"));
      }
    } finally {
      if (!signal?.aborted) setClassLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    void loadStudents(controller.signal);
    return () => controller.abort();
  }, [initialized, loadStudents]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClasses(controller.signal);
    return () => controller.abort();
  }, [loadClasses]);

  const openEditor = () => {
    if (!canWrite || saveBusy) return;
    const next = blank();
    setForm(next);
    setFormBaseline(JSON.stringify(next));
    setFormError("");
    setOpen(true);
  };

  const dismissEditor = useCallback(() => {
    if (saveBusyRef.current) return;
    if (dirtyRef.current && !window.confirm("学生档案尚未保存，确定放弃当前修改吗？")) return;
    setOpen(false);
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

  const applyFilters = () => {
    setMessage("");
    setAppliedFilters({ ...draftFilters, q: draftFilters.q.trim() });
  };

  const resetFilters = () => {
    const next = emptyFilters();
    setDraftFilters(next);
    setAppliedFilters(next);
    setMessage("");
  };

  const save = async () => {
    if (!canWrite || saveBusy) return;
    const name = form.name.trim();
    const grade = form.grade.trim();
    if (!name || !grade) {
      setFormError("请填写学生姓名与年级");
      return;
    }
    if (name.length > 40) {
      setFormError("学生姓名不超过 40 个字符");
      return;
    }
    setSaveBusy(true);
    setFormError("");
    setMessage("");
    try {
      const data = await requestJson<{ student?: Student }>("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, grade, name }),
      });
      if (!data?.student) throw new HttpError(200, "学生保存响应为空，请重试");
      setFormBaseline(JSON.stringify(form));
      setOpen(false);
      setForm(blank());
      setMessage("学生档案已保存");
      await loadStudents();
    } catch (reason) {
      setFormError(failureMessage(reason, "保存学生失败"));
    } finally {
      setSaveBusy(false);
    }
  };

  const metrics = useMemo(() => {
    const confirmed = rows.filter((student) => Boolean(student.riskConfirmed)).length;
    const gradeCount = new Set(rows.map((student) => student.grade).filter(Boolean)).size;
    const evidenceCount = rows.reduce(
      (sum, student) => sum + (student.reasons?.length || 0),
      0,
    );
    const highAttention = rows.filter((student) => Number(student.severity || 0) >= 3).length;
    return { confirmed, evidenceCount, gradeCount, highAttention };
  }, [rows]);

  return (
    <AppShell
      title="学生成长档案"
      subtitle="用已保存的课堂证据连接班级、薄弱点与阶段目标"
      actions={canWrite ? <Button onClick={openEditor}>录入学生</Button> : undefined}
    >
      <div className="studentOverviewPage">
        {message && <div className="studentOverviewNotice" role="status">{message}</div>}

        <nav className="studentGrowthRail" aria-label="班级与学生视图">
          <Link href="/classes"><span>教学组织</span><b>班级点名册</b></Link>
          <button
            aria-current={!attentionMode ? "page" : undefined}
            className={!attentionMode ? "isActive" : ""}
            onClick={() => setAttentionMode(false)}
          >
            <span>个人成长</span><b>学生档案</b>
          </button>
          <button
            aria-current={attentionMode ? "page" : undefined}
            className={attentionMode ? "isActive" : ""}
            onClick={() => setAttentionMode(true)}
          >
            <span>证据提醒</span><b>重点关注</b>
          </button>
        </nav>

        <div className="studentOverviewMetrics">
          <MetricCard
            label={attentionMode ? "重点关注学生" : "当前学生"}
            value={rows.length}
            detail={attentionMode ? "仅纳入命中明确规则的档案" : "当前筛选范围"}
          />
          <MetricCard
            label={attentionMode ? "高优先级" : "教师确认关注"}
            value={attentionMode ? metrics.highAttention : metrics.confirmed}
            detail={attentionMode ? "规则等级为高" : "由教师主动确认"}
          />
          <MetricCard
            label={attentionMode ? "证据条目" : "覆盖年级"}
            value={attentionMode ? metrics.evidenceCount : metrics.gradeCount}
            detail={attentionMode ? "可回看具体事实" : "当前列表中的年级数"}
          />
          <MetricCard
            label="隐私边界"
            value="受限"
            detail="联系方式不在普通列表展示"
          />
        </div>

        {attentionMode ? (
          <aside className="studentAttentionBasis" aria-label="重点关注规则依据">
            <div>
              <span>规则依据</span>
              <strong>{displayDate(attentionRange?.start)}—{displayDate(attentionRange?.today)}</strong>
              <p>系统只整理已有记录，不在证据不足时推断学生状态。</p>
            </div>
            <ul>
              {(attentionRules.length ? attentionRules : ["正在读取规则…"]).map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </aside>
        ) : (
          <Panel
            className="studentFilterPanel"
            eyebrow="成长索引"
            title="筛选学生档案"
            description="输入完成后点击“应用筛选”，避免每次键入都重复请求。"
          >
            <form
              className="studentFilterForm"
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters();
              }}
            >
              <label className="studentSearchField">
                姓名、学校或薄弱知识点
                <input
                  aria-label="搜索学生姓名、学校或薄弱知识点"
                  placeholder="输入关键词"
                  value={draftFilters.q}
                  onChange={(event) => setDraftFilters({ ...draftFilters, q: event.target.value })}
                />
              </label>
              <label>
                班级
                <select
                  disabled={classLoading || Boolean(classLoadError)}
                  value={draftFilters.classId}
                  onChange={(event) => setDraftFilters({ ...draftFilters, classId: event.target.value })}
                >
                  <option value="">{classLoading ? "正在读取班级…" : "全部班级"}</option>
                  {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                年级
                <select value={draftFilters.grade} onChange={(event) => setDraftFilters({ ...draftFilters, grade: event.target.value })}>
                  <option value="">全部年级</option>
                  {grades.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                关注状态
                <select value={draftFilters.risk} onChange={(event) => setDraftFilters({ ...draftFilters, risk: event.target.value })}>
                  <option value="">全部状态</option>
                  <option value="confirmed">教师确认关注</option>
                </select>
              </label>
              <div className="studentFilterActions">
                <Button type="submit">应用筛选</Button>
                <Button type="button" variant="quiet" onClick={resetFilters}>重置筛选</Button>
              </div>
            </form>
            {classLoadError && (
              <div className="studentClassError" role="alert">
                <span>班级选项暂时不可用：{classLoadError}</span>
                <Button variant="secondary" onClick={() => void loadClasses()}>重新读取班级选项</Button>
              </div>
            )}
          </Panel>
        )}

        {studentLoadError ? (
          <div className="studentOverviewError" role="alert">
            <div><strong>学生档案暂时无法读取</strong><p>{studentLoadError}</p></div>
            <Button variant="secondary" onClick={() => void loadStudents()}>重新读取学生档案</Button>
          </div>
        ) : loading ? (
          <div className="studentOverviewLoading" role="status">正在整理学生成长索引…</div>
        ) : (
          <Panel
            className="studentGrowthPanel"
            eyebrow={attentionMode ? "事实提醒" : "成长证据"}
            title={attentionMode ? "需要回看的学生记录" : "学生成长索引册"}
            description={attentionMode ? "每条提醒都附带规则命中的事实依据，最终判断仍由教师完成。" : "普通列表只展示教学必要信息；监护人联系方式不会出现在普通列表。"}
          >
            {rows.length === 0 ? (
              <EmptyState
                title={attentionMode ? "本期没有命中规则的重点关注学生" : "没有符合条件的学生档案"}
                description={attentionMode ? "没有证据就不作推断。后续课堂、作业和测验记录会继续进入规则检查。" : "重置筛选条件，或录入教学所需的最小学生信息。"}
                action={!attentionMode && canWrite ? <Button variant="secondary" onClick={openEditor}>录入第一名学生</Button> : undefined}
              />
            ) : (
              <div className={attentionMode ? "studentAttentionList" : "studentGrowthGrid"}>
                {rows.map((student) => attentionMode ? (
                  <article className="studentAttentionCard" key={student.id}>
                    <header>
                      <span className="studentAvatar" aria-hidden="true">{personInitial(student.name)}</span>
                      <div>
                        <h3>{student.name}</h3>
                        <p>{student.grade} · {student.reasons?.length || 0} 条事实依据</p>
                      </div>
                      <StatusBadge tone={Number(student.severity || 0) >= 3 ? "danger" : "warning"}>
                        {Number(student.severity || 0) >= 3 ? "优先回看" : "持续观察"}
                      </StatusBadge>
                    </header>
                    <ul>
                      {(student.reasons || []).map((reason) => (
                        <li key={`${reason.label}-${reason.evidence}`}>
                          <strong>{reason.label}</strong>
                          <p>{reason.evidence}</p>
                        </li>
                      ))}
                    </ul>
                    <Link className="zs-button zs-button--secondary" href={`/students/${student.id}`}>查看成长证据</Link>
                  </article>
                ) : (
                  <Link className="studentGrowthCard" href={`/students/${student.id}`} key={student.id}>
                    <header>
                      <span className="studentAvatar" aria-hidden="true">{personInitial(student.name)}</span>
                      <div>
                        <h3>{student.name}{student.nickname && <small>（{student.nickname}）</small>}</h3>
                        <p>{student.grade} · {student.school || "学校待记录"}</p>
                      </div>
                      {Boolean(student.riskConfirmed) && <StatusBadge tone="danger">教师确认关注</StatusBadge>}
                    </header>
                    <dl>
                      <div><dt>班级归属</dt><dd>{student.classNames || "暂未分班"}</dd></div>
                      <div><dt>薄弱知识点</dt><dd>{student.weakKnowledge || "暂无明确记录"}</dd></div>
                      <div><dt>阶段目标</dt><dd>{student.stageGoal || student.examGoal || "待与学生共同制定"}</dd></div>
                    </dl>
                    <footer><span>打开完整成长档案</span><b aria-hidden="true">→</b></footer>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>

      {canWrite && open && (
        <div
          className="modalBackdrop studentOverviewBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissEditor();
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="lessonModal studentOverviewDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="student-dialog-title"
          >
            <div className="modalTitle">
              <div><p>建立成长档案</p><h2 id="student-dialog-title">录入学生</h2></div>
              <button aria-label="关闭" disabled={saveBusy} onClick={dismissEditor}>×</button>
            </div>
            {formError && <div className="studentFormError" role="alert">{formError}</div>}
            <form
              className="studentOverviewForm"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset>
                <legend>基本信息</legend>
                <div className="studentFormGrid">
                  <label>姓名<input autoComplete="off" maxLength={40} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                  <label>昵称<input autoComplete="off" value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} /></label>
                  <label>所属班级<select disabled={classLoading || Boolean(classLoadError)} value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}><option value="">暂不分班</option>{classes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                  <label>年级<select value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })}>{grades.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label>学校<input value={form.school} onChange={(event) => setForm({ ...form, school: event.target.value })} /></label>
                  <label>教材版本<input value={form.textbookVersion} onChange={(event) => setForm({ ...form, textbookVersion: event.target.value })} /></label>
                  <label>选科 / 考试方向<input value={form.subjectChoice} onChange={(event) => setForm({ ...form, subjectChoice: event.target.value })} /></label>
                  <label>考试目标<input value={form.examGoal} onChange={(event) => setForm({ ...form, examGoal: event.target.value })} placeholder="如：中考、高考等级考" /></label>
                </div>
              </fieldset>

              <fieldset>
                <legend>学习画像</legend>
                <div className="studentFormGrid">
                  <label>基础水平<input value={form.foundationLevel} onChange={(event) => setForm({ ...form, foundationLevel: event.target.value })} /></label>
                  <label>优势<input value={form.strengths} onChange={(event) => setForm({ ...form, strengths: event.target.value })} /></label>
                  <label>薄弱知识点<input value={form.weakKnowledge} onChange={(event) => setForm({ ...form, weakKnowledge: event.target.value })} /></label>
                  <label>学习习惯<input value={form.learningHabits} onChange={(event) => setForm({ ...form, learningHabits: event.target.value })} /></label>
                  <label className="isWide">阶段目标<textarea value={form.stageGoal} onChange={(event) => setForm({ ...form, stageGoal: event.target.value })} /></label>
                </div>
              </fieldset>

              <fieldset>
                <legend>教师确认与隐私</legend>
                <div className="studentFormGrid">
                  <label>风险标签<select value={form.riskTags} onChange={(event) => setForm({ ...form, riskTags: event.target.value })}><option value="">无</option><option>缺勤</option><option>作业拖延</option><option>知识漏洞</option><option>情绪/沟通关注</option></select></label>
                  <label>教师确认<select value={form.riskConfirmed} onChange={(event) => setForm({ ...form, riskConfirmed: event.target.value })}><option value="false">不标记</option><option value="true">确认需关注</option></select></label>
                  <label className="isWide">监护人联系方式（可选，受限查看）<input autoComplete="off" value={form.guardianContact} onChange={(event) => setForm({ ...form, guardianContact: event.target.value })} /></label>
                  <label className="isWide">备注<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                </div>
                <p className="studentPrivacyNote">风险标签必须由教师手动确认；系统不会自动作出评价性结论。监护人联系方式不在普通列表展示。</p>
              </fieldset>

              <div className="studentDialogActions">
                <span className={formDirty ? "isDirty" : ""}>{formDirty ? "有未保存修改" : "信息尚未填写"}</span>
                <Button type="button" variant="secondary" disabled={saveBusy} onClick={dismissEditor}>取消</Button>
                <Button type="submit" disabled={saveBusy}>{saveBusy ? "正在保存…" : "保存学生"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
