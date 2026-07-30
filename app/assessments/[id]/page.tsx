"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { EmptyState, MetricCard, Panel, StatusBadge } from "../../components/ui/Primitives";
import { HttpError, requestJson } from "../../lib/http-client";

type Result = Record<string, any> & { studentId: number; name: string };
type ScoreField = {
  key: "score" | "objectiveScore" | "subjectiveScore" | "weakKnowledge" | "teacherNote";
  label: string;
  kind: "number" | "text";
  placeholder?: string;
};

const scoreFields: ScoreField[] = [
  { key: "score", label: "总分", kind: "number" },
  { key: "objectiveScore", label: "客观题", kind: "number" },
  { key: "subjectiveScore", label: "主观题", kind: "number" },
  { key: "weakKnowledge", label: "薄弱知识点", kind: "text", placeholder: "如：人民代表大会制度" },
  { key: "teacherNote", label: "教师备注", kind: "text", placeholder: "仅教师可见" },
];

const normalizeAssessmentResults = (items: Result[]) =>
  items.map((item) => {
    const normalized = { ...item };
    for (const field of scoreFields) {
      normalized[field.key] = item[field.key] == null ? "" : String(item[field.key]);
    }
    return normalized;
  });

const errorMessage = (reason: unknown, fallback: string) =>
  reason instanceof HttpError ? reason.message : fallback;

export default function AssessmentDetail() {
  const { id } = useParams<{ id: string }>();
  const [assessment, setAssessment] = useState<Record<string, any> | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [resultsBaseline, setResultsBaseline] = useState("");
  const [stats, setStats] = useState<Record<string, any>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [assessmentLoadError, setAssessmentLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const dirty = Boolean(resultsBaseline && JSON.stringify(results) !== resultsBaseline);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setAssessmentLoadError("");
    try {
      const data = await requestJson<{
        assessment?: Record<string, any>;
        results?: Result[];
        stats?: Record<string, any>;
      }>(`/api/assessments/${id}`, { signal });
      if (!data?.assessment) throw new HttpError(200, "测验成绩响应不完整，请重试");
      const normalizedResults = normalizeAssessmentResults(data.results || []);
      setAssessment(data.assessment);
      setResults(normalizedResults);
      setResultsBaseline(JSON.stringify(normalizedResults));
      setStats(data.stats || {});
    } catch (reason) {
      if (!signal?.aborted) {
        setAssessmentLoadError(errorMessage(reason, "暂时无法读取测验成绩"));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const updateResult = (studentId: number, key: string, value: string) => {
    setResults((items) =>
      items.map((item) => item.studentId === studentId ? { ...item, [key]: value } : item),
    );
    setMessage("");
  };

  const save = async (status = "draft") => {
    if (saving) return;
    if (
      status === "completed" &&
      !window.confirm("确认全部成绩已经核对无误？确认后本次测验会进入已完成状态。")
    ) return;

    setSaving(true);
    setMessage("");
    try {
      await requestJson(`/api/assessments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results, status }),
      });
      setResultsBaseline(JSON.stringify(results));
      setMessage(status === "completed" ? "成绩已确认完成" : "成绩草稿已保存");
      setReloadKey((value) => value + 1);
    } catch (reason) {
      setMessage(errorMessage(reason, "保存成绩失败"));
    } finally {
      setSaving(false);
    }
  };

  const live = useMemo(() => {
    const scores = results
      .map((item) => item.score === "" || item.score == null ? null : Number(item.score))
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
    return scores.length
      ? {
          average: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10,
          highest: Math.max(...scores),
          lowest: Math.min(...scores),
          count: scores.length,
        }
      : { average: null, highest: null, lowest: null, count: 0 };
  }, [results]);

  if (!assessment) {
    return (
      <AppShell title="测验成绩" subtitle="读取班级测验与学生成绩">
        {assessmentLoadError ? (
          <div className="assessmentDetailLoadError" role="alert">
            <div>
              <strong>无法打开测验</strong>
              <p>{assessmentLoadError}</p>
            </div>
            <button className="secondaryButton" onClick={() => setReloadKey((value) => value + 1)}>
              重新读取测验
            </button>
          </div>
        ) : (
          <div className="assessmentDetailLoading" role="status">
            {loading ? "正在读取测验成绩…" : "暂时没有可显示的测验数据"}
          </div>
        )}
      </AppShell>
    );
  }

  const scoreRate =
    live.average == null
      ? null
      : Math.round(live.average / Number(assessment.totalScore) * 1000) / 10;

  return (
    <AppShell
      title={assessment.title}
      subtitle={`${assessment.className} · ${assessment.type} · 总分 ${assessment.totalScore}`}
      actions={(
        <>
          <a className="secondaryButton" href={`/api/exports/assessments?assessmentId=${id}`}>
            导出本次成绩
          </a>
          <button className="primaryButton" disabled={saving} onClick={() => save("completed")}>
            {saving ? "正在保存…" : "确认全部成绩"}
          </button>
        </>
      )}
    >
      <div className="assessmentDetailPage">
        {assessmentLoadError && (
          <div className="assessmentDetailLoadError" role="alert">
            <div>
              <strong>成绩刷新失败</strong>
              <p>{assessmentLoadError}</p>
            </div>
            <button className="secondaryButton" onClick={() => setReloadKey((value) => value + 1)}>
              重新读取测验
            </button>
          </div>
        )}

        {message && <div className="assessmentDetailNotice" role="status">{message}</div>}

        <div className="assessmentDetailContext">
          <StatusBadge tone={assessment.status === "completed" ? "success" : "warning"}>
            {assessment.status === "completed" ? "已完成" : "录入中"}
          </StatusBadge>
          <span>统计随当前录入即时更新，保存后才会写入正式记录。</span>
        </div>

        {live.count > 0 && live.count < 3 && (
          <div className="assessmentSampleNotice">
            <b>当前仅录入 {live.count} 名学生</b>
            <span>样本不足，暂不展示班级排名或趋势判断；继续录入后再用于学情分析。</span>
          </div>
        )}

        <section className="assessmentDetailMetricGrid" aria-label="当前成绩概览">
          <MetricCard label="已录人数" value={live.count} detail={`班级共 ${results.length} 人`} />
          <MetricCard label="平均分" value={live.average ?? "—"} detail="仅统计已录总分" />
          <MetricCard label="最高分" value={live.highest ?? "—"} detail="当前录入" />
          <MetricCard label="最低分" value={live.lowest ?? "—"} detail="当前录入" />
          <MetricCard label="平均得分率" value={scoreRate == null ? "—" : `${scoreRate}%`} detail={`满分 ${assessment.totalScore}`} />
        </section>

        {stats.weakKnowledge?.length > 0 && (
          <Panel
            className="assessmentWeakPanel"
            eyebrow="基于已保存记录"
            title="班级共性薄弱知识点"
            description="仅汇总教师已经保存的薄弱知识点标记。"
          >
            <div className="assessmentWeakTags">
              {stats.weakKnowledge.map((item: any) => (
                <span key={item.name}>{item.name} · {item.count}人</span>
              ))}
            </div>
          </Panel>
        )}

        <Panel
          className="assessmentScorePanel"
          eyebrow="批量录入"
          title="学生成绩"
          description="总分用于统计；客观题、主观题、薄弱知识点和备注用于后续复盘。"
          actions={(
            <div className="assessmentSaveActions">
              <span className={dirty ? "isDirty" : ""} role="status">
                {saving ? "正在保存…" : dirty ? "有未保存修改" : "全部已保存"}
              </span>
              <button
                className="secondaryButton"
                disabled={saving || !dirty}
                onClick={() => save("draft")}
              >
                保存草稿
              </button>
            </div>
          )}
        >
          {results.length === 0 ? (
            <EmptyState title="班级暂无学生" description="请先将学生加入班级，再录入成绩。" />
          ) : (
            <div className="assessmentScoreTable">
              <header className="assessmentScoreHeader" aria-hidden="true">
                <b>学生</b>
                {scoreFields.map((field) => <b key={field.key}>{field.label}</b>)}
              </header>
              <div className="assessmentScoreRows">
                {results.map((row) => (
                  <article className="assessmentScoreRow" key={row.studentId}>
                    <div className="assessmentStudent">
                      <b>{row.name}</b>
                      <span>{row.grade || "年级待补"}</span>
                    </div>
                    {scoreFields.map((field) => (
                      <label
                        className={`assessmentScoreField assessmentScoreField--${field.kind}`}
                        data-label={field.label}
                        key={field.key}
                      >
                        <span>{field.label}</span>
                        <input
                          aria-label={`${row.name}${field.label}`}
                          type={field.kind === "number" ? "number" : "text"}
                          min={field.kind === "number" ? "0" : undefined}
                          max={field.kind === "number" ? assessment.totalScore : undefined}
                          value={row[field.key] ?? ""}
                          onChange={(event) => updateResult(row.studentId, field.key, event.target.value)}
                          placeholder={field.placeholder}
                        />
                      </label>
                    ))}
                  </article>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
