"use client";

import Link from "@/app/components/HardNavigationLink";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { useSessionState } from "../../components/SessionProvider";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../../components/ui/Primitives";
import { HttpError, requestJson } from "../../lib/http-client";

type ClassRecord = {
  id: number;
  name: string;
  stage: string;
  grade: string;
  courseType?: string | null;
  startDate?: string | null;
  schedule?: string | null;
  notes?: string | null;
  status?: string;
};

type Student = {
  id: number;
  name: string;
  nickname?: string | null;
  grade?: string | null;
  weakKnowledge?: string | null;
  riskTags?: string | null;
  riskConfirmed?: boolean;
};

type Lesson = {
  id: number;
  date: string;
  startTime?: string | null;
  courseName: string;
  topic?: string | null;
  status?: string;
};

type Assessment = {
  id: number;
  title: string;
  date?: string | null;
  totalScore: number;
  status?: string;
  resultCount?: number;
  averageScore?: number | null;
};

type WeakKnowledge = { name: string; count: number };

type ClassData = {
  class: ClassRecord;
  members: Student[];
  lessons: Lesson[];
  assessments: Assessment[];
  weakKnowledge: WeakKnowledge[];
  attendanceRate: number | null;
  homeworkRate: number | null;
};

type MutationKey = "add" | number | null;

const failureMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError || reason instanceof Error ? reason.message : fallback;

const classStatus = (status?: string) => status === "archived"
  ? { label: "已归档", tone: "neutral" as const }
  : { label: "进行中", tone: "success" as const };

const lessonStatus = (status?: string) => {
  if (status === "completed") return { label: "已完成", tone: "success" as const };
  if (status === "cancelled") return { label: "已取消", tone: "neutral" as const };
  if (status === "scheduled") return { label: "待上课", tone: "info" as const };
  return { label: "草稿", tone: "warning" as const };
};

const studentMark = (name: string) => name.replace(/^【[^】]+】/, "").trim().slice(0, 1) || "生";

export default function ClassDetail() {
  const { id } = useParams<{ id: string }>();
  const { session } = useSessionState();
  const canWrite = session.role === "teacher";
  const canScheduleLesson = session.role === "teacher" || session.role === "assistant";
  const [data, setData] = useState<ClassData | null>(null);
  const [all, setAll] = useState<Student[]>([]);
  const [pick, setPick] = useState("");
  const [loading, setLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState("");
  const [candidateLoadError, setCandidateLoadError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [message, setMessage] = useState("");
  const [mutationBusy, setMutationBusy] = useState<MutationKey>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [candidateReloadKey, setCandidateReloadKey] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setDetailLoadError("");
    try {
      const result = await requestJson<ClassData>(`/api/classes/${id}`, { signal });
      if (!result?.class) throw new HttpError(200, "班级详情响应不完整，请重试");
      setData({
        ...result,
        members: result.members || [],
        lessons: result.lessons || [],
        assessments: result.assessments || [],
        weakKnowledge: result.weakKnowledge || [],
      });
    } catch (reason) {
      if (!signal?.aborted) setDetailLoadError(failureMessage(reason, "暂时无法读取班级详情"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [id]);

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    if (!canWrite) {
      setAll([]);
      setCandidateLoadError("");
      setCandidateLoading(false);
      return;
    }
    setCandidateLoading(true);
    setCandidateLoadError("");
    try {
      const result = await requestJson<{ students?: Student[] }>("/api/students?status=active", { signal });
      if (!result) throw new HttpError(200, "可加入学生响应为空，请重试");
      setAll(result.students || []);
    } catch (reason) {
      if (!signal?.aborted) setCandidateLoadError(failureMessage(reason, "暂时无法读取可加入学生"));
    } finally {
      if (!signal?.aborted) setCandidateLoading(false);
    }
  }, [canWrite]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCandidates(controller.signal);
    return () => controller.abort();
  }, [candidateReloadKey, loadCandidates]);

  const candidates = useMemo(() => {
    const memberIds = new Set((data?.members || []).map((member) => member.id));
    return all.filter((student) => !memberIds.has(student.id));
  }, [all, data?.members]);

  const refresh = async () => {
    await load();
    await loadCandidates();
  };

  const add = async () => {
    if (!pick || mutationBusy) return;
    setMutationBusy("add");
    setMutationError("");
    setMessage("");
    try {
      const result = await requestJson<{ ok?: boolean }>(`/api/classes/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: Number(pick) }),
      });
      if (!result?.ok) throw new HttpError(200, "加入班级响应不完整，请重试");
      setPick("");
      setMessage("学生已加入班级");
      await refresh();
    } catch (reason) {
      setMutationError(failureMessage(reason, "加入班级失败"));
    } finally {
      setMutationBusy(null);
    }
  };

  const remove = async (student: Student) => {
    if (mutationBusy) return;
    if (!window.confirm(`确认将“${student.name}”移出班级？学生档案与历史记录不会删除。`)) return;
    setMutationBusy(student.id);
    setMutationError("");
    setMessage("");
    try {
      const result = await requestJson<{ ok?: boolean }>(`/api/classes/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      if (!result?.ok) throw new HttpError(200, "移出班级响应不完整，请重试");
      setMessage(`${student.name}已移出班级`);
      await refresh();
    } catch (reason) {
      setMutationError(failureMessage(reason, "移出班级失败"));
    } finally {
      setMutationBusy(null);
    }
  };

  if (!data) {
    return (
      <AppShell title="班级详情" subtitle="读取班级档案与教学证据">
        {detailLoadError ? (
          <div className="classDetailLoadError" role="alert">
            <div><strong>无法打开班级</strong><p>{detailLoadError}</p></div>
            <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
              重新读取班级详情
            </Button>
          </div>
        ) : (
          <div className="classDetailLoading" role="status">
            {loading ? "正在整理班级档案…" : "暂时没有可显示的班级数据"}
          </div>
        )}
      </AppShell>
    );
  }

  const value = data.class;
  const status = classStatus(value.status);

  return (
    <AppShell
      title={value.name}
      subtitle={`${value.stage} · ${value.grade} · ${value.courseType || "未设置课程类型"}`}
      actions={canScheduleLesson ? (
        <Link className="zs-button zs-button--primary" href={`/lessons?new=1&class=${id}`}>
          安排课时
        </Link>
      ) : undefined}
    >
      <div className="classDetailPage">
        {detailLoadError && (
          <div className="classDetailInlineError" role="alert">
            <div><strong>班级数据刷新失败</strong><p>{detailLoadError}</p></div>
            <Button variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
              重新读取班级详情
            </Button>
          </div>
        )}
        {mutationError && <div className="classDetailMutationError" role="alert">{mutationError}</div>}
        {message && <div className="classDetailNotice" role="status">{message}</div>}

        <section className="classDetailIdentity" aria-label="班级档案摘要">
          <div>
            <p>班级档案 · {value.stage}</p>
            <strong>{value.schedule || "尚未设置固定课表"}</strong>
            <span>
              {value.startDate ? `${value.startDate} 开课` : "开课日期待补充"}
              {value.notes ? ` · ${value.notes}` : " · 课堂备注待补充"}
            </span>
          </div>
          <div className="classDetailIdentityActions">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <Link href="/classes">返回班级册</Link>
          </div>
        </section>

        <nav className="classDetailJumpNav" aria-label="班级详情快捷导航">
          <a href="#class-members"><span>01</span>学生点名册</a>
          <a href="#class-lessons"><span>02</span>课时时间线</a>
          <a href="#class-assessments"><span>03</span>测验与学情</a>
        </nav>

        <section className="classDetailMetrics" aria-label="班级教学概览">
          <MetricCard label="在班学生" value={data.members.length} detail="当前有效班级关系" />
          <MetricCard label="累计课时" value={data.lessons.length} detail="按日期由近到远" />
          <MetricCard
            label="平均出勤"
            value={data.attendanceRate == null ? "—" : `${data.attendanceRate}%`}
            detail={data.attendanceRate == null ? "尚无出勤记录" : "按已记录出勤计算"}
          />
          <MetricCard
            label="作业完成"
            value={data.homeworkRate == null ? "—" : `${data.homeworkRate}%`}
            detail={data.homeworkRate == null ? "尚无作业记录" : "仅统计教师确认完成"}
          />
        </section>

        <div className="classDetailGrid">
          <Panel
            className="classDetailMembers"
            id="class-members"
            eyebrow="成员管理"
            title="班级学生"
            description="风险提示只展示教师已经确认并留下记录的内容。"
            actions={canWrite ? (
              <Link className="classDetailTextLink" href="/students?new=1">录入新学生</Link>
            ) : undefined}
          >
            {!canWrite ? (
              <div className="classDetailReadOnly">助教可查看已授权班级，但成员调整由教师完成。</div>
            ) : (
              <div className="classDetailCandidateArea">
                {candidateLoadError ? (
                  <div className="classDetailCandidateError" role="alert">
                    <span>{candidateLoadError}</span>
                    <Button variant="quiet" onClick={() => setCandidateReloadKey((value) => value + 1)}>
                      重新读取可加入学生
                    </Button>
                  </div>
                ) : (
                  <div className="classDetailInlineAdd">
                    <label htmlFor="class-student-pick">加入已有学生</label>
                    <select
                      id="class-student-pick"
                      value={pick}
                      disabled={Boolean(mutationBusy) || candidateLoading}
                      onChange={(event) => setPick(event.target.value)}
                    >
                      <option value="">
                        {candidateLoading ? "正在读取学生…" : candidates.length ? "选择学生" : "没有可加入的学生"}
                      </option>
                      {candidates.map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.name} · {student.grade || "年级待补充"}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={Boolean(mutationBusy) || candidateLoading || !pick}
                      onClick={() => void add()}
                    >
                      {mutationBusy === "add" ? "正在加入…" : "加入班级"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {data.members.length === 0 ? (
              <EmptyState
                title="班级还没有学生"
                description={canWrite ? "从已有学生档案中选择加入，或先录入一名新学生。" : "教师添加学生后，点名册会显示在这里。"}
                action={canWrite ? <Link href="/students?new=1" className="zs-button zs-button--secondary">录入学生</Link> : undefined}
              />
            ) : (
              <div className="classDetailMemberList">
                {data.members.map((student) => (
                  <article key={student.id}>
                    <span className="classDetailStudentMark" aria-hidden="true">{studentMark(student.name)}</span>
                    <Link href={`/students/${student.id}`}>
                      <strong>{student.name}{student.nickname ? <small>（{student.nickname}）</small> : null}</strong>
                      <span>{student.grade || "年级待补充"} · {student.weakKnowledge || "暂无薄弱知识点记录"}</span>
                    </Link>
                    {student.riskConfirmed ? (
                      <StatusBadge tone="warning">{student.riskTags || "教师确认关注"}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">暂无确认关注</StatusBadge>
                    )}
                    {canWrite && (
                      <Button
                        variant="quiet"
                        aria-label={`将${student.name}移出班级`}
                        disabled={Boolean(mutationBusy)}
                        onClick={() => void remove(student)}
                      >
                        {mutationBusy === student.id ? "正在移出…" : "移出"}
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            className="classDetailLessons"
            id="class-lessons"
            eyebrow="课程时间线"
            title="近期课时"
            description="最近六节课按日期由近到远排列。"
          >
            {data.lessons.length === 0 ? (
              <EmptyState
                title="还没有课时"
                description="安排第一节课后，这里会形成班级课程时间线。"
                action={canScheduleLesson ? <Link className="zs-button zs-button--secondary" href={`/lessons?new=1&class=${id}`}>安排课时</Link> : undefined}
              />
            ) : (
              <div className="classDetailTimeline">
                {data.lessons.slice(0, 6).map((lesson) => {
                  const lessonState = lessonStatus(lesson.status);
                  return (
                    <Link href={`/lessons/${lesson.id}`} key={lesson.id}>
                      <time>{lesson.date}{lesson.startTime ? ` · ${lesson.startTime}` : ""}</time>
                      <strong>{lesson.topic || lesson.courseName}</strong>
                      <StatusBadge tone={lessonState.tone}>{lessonState.label}</StatusBadge>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            className="classDetailAssessments"
            id="class-assessments"
            eyebrow="真实测验数据"
            title="近期成绩变化"
            description="只呈现已录入的测验与分数，不对缺少样本的情况做推断。"
            actions={canWrite ? <Link className="classDetailTextLink" href={`/assessments?classId=${id}`}>管理测验</Link> : undefined}
          >
            {data.assessments.length === 0 ? (
              <EmptyState
                title="还没有测验"
                description="新建测验并录入成绩后，这里会显示班级变化。"
                action={canWrite ? <Link className="zs-button zs-button--secondary" href="/assessments">新建测验</Link> : undefined}
              />
            ) : (
              <div className="classDetailAssessmentList">
                {data.assessments.map((item) => (
                  <Link href={`/assessments/${item.id}`} key={item.id}>
                    <div><time>{item.date || "日期待补充"}</time><strong>{item.title}</strong></div>
                    <span>平均 {item.averageScore ?? "—"} / {item.totalScore}</span>
                    <StatusBadge tone={item.status === "completed" ? "success" : "warning"}>
                      {item.status === "completed" ? "已完成" : "录入中"}
                    </StatusBadge>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            className="classDetailKnowledge"
            eyebrow="教师录入汇总"
            title="共性薄弱知识点"
            description="按不同学生去重统计，避免同一学生多次测验被重复计数。"
          >
            {data.weakKnowledge.length === 0 ? (
              <EmptyState title="数据不足" description="在成绩录入时填写薄弱知识点后自动汇总。" />
            ) : (
              <ol className="classDetailKnowledgeList">
                {data.weakKnowledge.map((item, index) => (
                  <li key={item.name}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{item.name}</strong>
                    <em>{item.count} 人</em>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
