"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { HttpError, requestJson } from "../lib/http-client";
import styles from "./analytics.module.css";

type Range = "week" | "month" | "term";
type LoadState = "loading" | "ready" | "empty" | "permission" | "server-error" | "error";
type Row = Record<string, unknown>;

type AnalyticsData = {
  range: unknown;
  start: unknown;
  teaching: Row;
  classroom: Row;
  questionBank: Row;
  growth: Row;
  studentTrend: Row[];
  homeworkTrend: Row[];
};

const rangeOptions: Array<{ value: Range; label: string; days: string }> = [
  { value: "week", label: "本周（近 7 天）", days: "7 天" },
  { value: "month", label: "本月（近 30 天）", days: "30 天" },
  { value: "term", label: "本学期（180 天）", days: "180 天" },
];

const asRecord = (value: unknown): Row | null => (
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : null
);

const asRows = (value: unknown): Row[] => (
  Array.isArray(value) ? value.filter((item): item is Row => Boolean(asRecord(item))) : []
);

const parseData = (value: unknown): AnalyticsData | null => {
  const record = asRecord(value);
  const teaching = asRecord(record?.teaching);
  const classroom = asRecord(record?.classroom);
  const questionBank = asRecord(record?.questionBank);
  const growth = asRecord(record?.growth);
  if (!record || !teaching || !classroom || !questionBank || !growth) return null;
  return {
    range: record.range,
    start: record.start,
    teaching,
    classroom,
    questionBank,
    growth,
    studentTrend: asRows(record.studentTrend),
    homeworkTrend: asRows(record.homeworkTrend),
  };
};

const numericValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const integerText = (value: unknown): string => {
  const number = numericValue(value);
  return number === null ? "数据不足" : new Intl.NumberFormat("zh-CN").format(Math.round(number));
};

const countText = (value: unknown): string => {
  const number = numericValue(value);
  return number === null || number <= 0 ? "数据不足" : integerText(number);
};

const formatPercentage = (value: unknown): string => {
  const number = numericValue(value);
  if (number === null) return "数据不足";
  const safe = Math.min(100, Math.max(0, number));
  return `${Number.isInteger(safe) ? safe : safe.toFixed(1)}%`;
};

const formatAverage = (value: unknown): string => {
  const number = numericValue(value);
  return number === null ? "数据不足" : number.toFixed(1);
};

const formatDate = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "日期未记录";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "日期未记录";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
};

const dateValue = (value: unknown): string | undefined => (
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
);

const formatCompletion = (row: Row): string => {
  const completed = numericValue(row.completed);
  const total = numericValue(row.total);
  if (completed === null || total === null || total <= 0) return "数据不足";
  return `${integerText(completed)}/${integerText(total)} 已完成（${formatPercentage(completed / total * 100)}）`;
};

const hasUsableRecord = (value: unknown): boolean => {
  const number = numericValue(value);
  return number !== null && number > 0;
};

const hasAnyRecord = (data: AnalyticsData): boolean => (
  hasUsableRecord(data.teaching.lessons) ||
  hasUsableRecord(data.classroom.assessmentCount) ||
  hasUsableRecord(data.questionBank.total) ||
  hasUsableRecord(data.growth.reflections) ||
  data.studentTrend.length > 0 ||
  data.homeworkTrend.length > 0 ||
  asRows(data.classroom.knowledgeMastery).length > 0 ||
  asRows(data.questionBank.difficulty).length > 0
);

const rangeText = (selectedRange: Range, start: unknown): string => {
  const option = rangeOptions.find((item) => item.value === selectedRange) || rangeOptions[0];
  return `${option.label}；起始日期：${formatDate(start)}；统计至本次读取`;
};

function MetricCard({
  label,
  value,
  range,
  source,
  definition,
}: {
  label: string;
  value: string;
  range: string;
  source: string;
  definition: string;
}) {
  return (
    <article className={styles.metricCard}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>{value}</strong>
      <p className={styles.evidence}><b>统计范围：</b>{range}</p>
      <p className={styles.evidence}><b>数据来源：</b>{source}</p>
      <details className={styles.calculation}>
        <summary>口径说明</summary>
        <p>{definition}</p>
      </details>
    </article>
  );
}

function ModuleSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.module} aria-labelledby={id}>
      <header className={styles.moduleHeader}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id={id}>{title}</h2>
        </div>
        <p className={styles.moduleDescription}>{description}</p>
      </header>
      {children}
    </section>
  );
}

function Insufficient({ children }: { children: ReactNode }) {
  return <p className={styles.insufficient}>{children}</p>;
}

function StudentTrend({ rows, range }: { rows: Row[]; range: string }) {
  if (rows.length < 2) {
    return <Insufficient>数据不足，至少两个日期的课堂表现记录后才显示学生学习趋势。</Insufficient>;
  }
  return (
    <div className={styles.trendBlock}>
      <p className={styles.evidence}><b>统计范围：</b>{range}；<b>数据来源：</b>student_lesson_records 按 lessons.date 分组的原始均值。</p>
      <ol className={styles.trendList} aria-label="学生学习趋势数据列表">
        {rows.map((row, index) => {
          const rawDate = dateValue(row.date);
          return (
            <li className={styles.trendItem} key={`${String(row.date)}-${index}`}>
              <time dateTime={rawDate}>{formatDate(row.date)}</time>
              <div>
                <p><span>参与度</span><strong>{formatAverage(row.participation)}</strong></p>
                <p><span>理解度</span><strong>{formatAverage(row.understanding)}</strong></p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function HomeworkTrend({ rows, range }: { rows: Row[]; range: string }) {
  if (rows.length < 2) {
    return <Insufficient>数据不足，至少两个日期的作业提交记录后才显示作业趋势。</Insufficient>;
  }
  return (
    <div className={styles.trendBlock}>
      <p className={styles.evidence}><b>统计范围：</b>{range}；<b>数据来源：</b>assignment_submissions 按 lessons.date 分组。</p>
      <ol className={styles.trendList} aria-label="作业趋势数据列表">
        {rows.map((row, index) => {
          const rawDate = dateValue(row.date);
          return (
            <li className={styles.trendItem} key={`${String(row.date)}-${index}`}>
              <time dateTime={rawDate}>{formatDate(row.date)}</time>
              <div><p><span>完成情况</span><strong>{formatCompletion(row)}</strong></p></div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function DifficultyList({ rows, range }: { rows: Row[]; range: string }) {
  if (!rows.length) return <Insufficient>数据不足，添加正式题目并记录难度后才显示覆盖分布。</Insufficient>;
  return (
    <div className={styles.dataBlock}>
      <p className={styles.evidence}><b>统计范围：</b>正式题库当前记录（不受日期筛选影响）；<b>数据来源：</b>questions.status 为 active。</p>
      <ol className={styles.dataList} aria-label="题库难度分布数据列表">
        {rows.map((row, index) => <li className={styles.dataRow} key={`${String(row.difficulty)}-${index}`}><span>{row.difficulty == null ? "难度未标注" : `${String(row.difficulty)} 级`}</span><strong>{countText(row.count)}</strong><em>道</em></li>)}
      </ol>
      <p className={styles.evidence}>当前筛选：{range}；题库总量按正式题目统计，不把未校对题目混入。</p>
    </div>
  );
}

function KnowledgeList({ rows, range }: { rows: Row[]; range: string }) {
  if (!rows.length) return <Insufficient>数据不足，录入带知识点掌握记录的测验结果后才显示。</Insufficient>;
  return (
    <div className={styles.dataBlock}>
      <p className={styles.evidence}><b>统计范围：</b>{range}；<b>数据来源：</b>assessment_results.knowledge_mastery。</p>
      <ul className={styles.dataList} aria-label="知识点掌握记录列表">
        {rows.map((row, index) => <li className={styles.dataRow} key={`${String(row.mastery)}-${index}`}><span>{String(row.mastery || "掌握度未记录")}</span><strong>{countText(row.count)}</strong><em>条</em></li>)}
      </ul>
    </div>
  );
}

function RepeatedProblems({ rows, range }: { rows: Row[]; range: string }) {
  if (!rows.length) return <Insufficient>数据不足，至少需要重复出现的问题记录后才显示改进线索。</Insufficient>;
  return (
    <div className={styles.dataBlock}>
      <p className={styles.evidence}><b>统计范围：</b>{range}；<b>数据来源：</b>reflections.difficulties，接口仅返回出现次数大于 1 的记录。</p>
      <ul className={styles.dataList} aria-label="重复问题列表">
        {rows.map((row, index) => <li className={styles.dataRow} key={`${String(row.difficulties)}-${index}`}><span>{String(row.difficulties || "问题未记录")}</span><strong>{countText(row.count)}</strong><em>次</em></li>)}
      </ul>
    </div>
  );
}

function StateCard({ state, onRetry }: { state: Exclude<LoadState, "ready">; onRetry: () => void }) {
  if (state === "loading") {
    return <div className={styles.stateCard} role="status" aria-live="polite"><h2>正在读取数据中心</h2><p>正在按已应用的统计范围整理真实记录，未完成前不展示推测值。</p></div>;
  }
  if (state === "empty") {
    return <div className={styles.stateCard} role="status"><h2>当前范围暂无可用记录</h2><p>没有足够的课时、学习、题库、作业或反思记录可供计算。补充真实记录后再读取，不用 0 代替数据不足。</p><button className={styles.secondaryButton} type="button" onClick={onRetry}>重新读取</button></div>;
  }
  if (state === "permission") {
    return <div className={styles.stateCard} role="alert"><h2>暂无权限查看数据中心</h2><p>当前账号没有 analytics:read 权限。页面不会展示学生明细或财务数据。</p><button className={styles.secondaryButton} type="button" onClick={onRetry}>重新读取</button></div>;
  }
  if (state === "server-error") {
    return <div className={styles.stateCard} role="alert"><h2>数据中心暂时不可用</h2><p>服务器没有完成本次统计。请稍后重试；在读取成功前不会保留旧结论。</p><button className={styles.secondaryButton} type="button" onClick={onRetry}>重新读取</button></div>;
  }
  return <div className={styles.stateCard} role="alert"><h2>读取数据中心失败</h2><p>网络或返回内容异常。请检查连接后重试。</p><button className={styles.secondaryButton} type="button" onClick={onRetry}>重新读取</button></div>;
}

export default function AnalyticsPage() {
  const [draftRange, setDraftRange] = useState<Range>("week");
  const [appliedRange, setAppliedRange] = useState<Range>("week");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const loadRequest = useRef<AbortController | null>(null);

  const loadData = useCallback(async (selectedRange: Range) => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setData(null);
    setLoadState("loading");
    try {
      const payload = await requestJson<unknown>(`/api/analytics?range=${selectedRange}`, {
        signal: controller.signal,
        timeoutMs: 15_000,
        cache: "no-store",
      });
      if (controller.signal.aborted) return;
      const parsed = parseData(payload);
      if (!parsed) throw new HttpError(502, "数据中心返回的数据不完整");
      setData(parsed);
      setLoadState(hasAnyRecord(parsed) ? "ready" : "empty");
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
      if (reason instanceof HttpError && reason.status === 401) setLoadState("permission");
      else if (reason instanceof HttpError && reason.status === 403) setLoadState("permission");
      else if (reason instanceof HttpError && reason.status >= 500) setLoadState("server-error");
      else setLoadState("error");
    } finally {
      if (loadRequest.current === controller) loadRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void loadData(appliedRange);
    return () => loadRequest.current?.abort();
  }, [appliedRange, loadData]);

  const applyFilters = () => {
    setAppliedRange(draftRange);
  };

  const resetFilters = () => {
    setDraftRange("week");
    setAppliedRange("week");
  };

  const retry = () => {
    void loadData(appliedRange);
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyFilters();
  };

  const selectedRange = rangeOptions.find((item) => item.value === appliedRange) || rangeOptions[0];
  const evidenceRange = rangeText(appliedRange, data?.start);
  const difficulty = data ? asRows(data.questionBank.difficulty) : [];
  const knowledgeMastery = data ? asRows(data.classroom.knowledgeMastery) : [];
  const frequent = data ? asRows(data.questionBank.frequent) : [];
  const repeatedProblems = data ? asRows(data.growth.repeatedProblems) : [];

  return (
    <AppShell title="数据中心" subtitle="所有数字均保留统计范围、来源和计算说明；数据不足时不制造结论">
      <div className={styles.page}>
        <header className={styles.pageIntro}>
          <div>
            <p className={styles.eyebrow}>证据化教学观察</p>
            <h2>把记录变成可复核的教学线索</h2>
            <p className={styles.introText}>这里只汇总当前教师工作区的聚合记录，不展示学生姓名、联系方式或财务明细。</p>
          </div>
          <p className={styles.privacyNote}>统计范围可重新应用；输入选择不会立即请求。</p>
        </header>

        <form className={styles.filterBar} onSubmit={submitFilters} aria-label="数据中心筛选条件">
          <label className={styles.filterLabel} htmlFor="analytics-range">
            <span>统计范围</span>
            <select id="analytics-range" value={draftRange} onChange={(event) => setDraftRange(event.target.value as Range)}>
              {rangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}（{option.days}）</option>)}
            </select>
          </label>
          <div className={styles.filterActions}>
            <button className={styles.primaryButton} type="submit">应用筛选</button>
            <button className={styles.secondaryButton} type="button" onClick={resetFilters}>重置筛选</button>
            <span className={styles.appliedRange}>已应用：{selectedRange.label}</span>
          </div>
        </form>

            {loadState !== "ready" || !data ? <StateCard state={loadState === "ready" ? "error" : loadState} onRetry={retry} /> : (
          <>
            {!hasAnyRecord(data) && <StateCard state="empty" onRetry={retry} />}

            <ModuleSection id="teaching-efficiency" eyebrow="模块一 · 教学效率" title="教学效率" description="课时、备课、完成和反馈的记录质量；每项都按已应用范围计算。">
              <div className={styles.metricGrid}>
                <MetricCard label="课时记录" value={countText(data.teaching.lessons)} range={evidenceRange} source="lessons.date / lessons.id" definition="所选范围内创建的全部课时数量；不把没有记录的日期补成课时。" />
                <MetricCard label="备课完成率" value={formatPercentage(data.teaching.prepRate)} range={evidenceRange} source="lessons.teaching_goals 与 lessons.key_points" definition="同时填写教学目标和重点的课时数 ÷ 全部课时数；分母为 0 时显示数据不足。" />
                <MetricCard label="课时完成率" value={formatPercentage(data.teaching.completedRate)} range={evidenceRange} source="lessons.status" definition="status='completed' 的课时数 ÷ 所选范围内全部课时数；分母为 0 时显示数据不足。" />
                <MetricCard label="反馈及时率" value={formatPercentage(data.teaching.feedbackRate)} range={evidenceRange} source="feedback.confirmed_at 与 lessons.date" definition="课后 48 小时内确认的关联反馈数 ÷ 所选范围内反馈记录总数；分母为 0 时显示数据不足。" />
              </div>
            </ModuleSection>

            <div className={styles.twoColumn}>
              <ModuleSection id="student-learning" eyebrow="模块二 · 学习证据" title="学生学习" description="只展示工作区聚合结果，不展开学生身份信息。">
                <div className={styles.metricGrid}>
                  <MetricCard label="出勤率" value={formatPercentage(data.classroom.attendanceRate)} range={evidenceRange} source="attendance.status 与 lessons.date" definition="status='present' 的出勤记录数 ÷ 全部出勤记录；分母为 0 时显示数据不足。" />
                  <MetricCard label="作业完成率" value={formatPercentage(data.classroom.homeworkRate)} range={evidenceRange} source="assignment_submissions.status" definition="已完成提交数 ÷ 全部作业提交记录；分母为 0 时显示数据不足。" />
                  <MetricCard label="测验平均分" value={formatAverage(data.classroom.assessmentAverage)} range={evidenceRange} source="assessment_results.score 与 assessments.date" definition="仅对已有 score 的测验结果取算术平均；没有有效分数时显示数据不足。" />
                  <MetricCard label="有分数的测验记录" value={countText(data.classroom.assessmentCount)} range={evidenceRange} source="assessment_results.score" definition="只计入 score 非空的测验结果；无有效成绩时不输出 0 作为结论。" />
                </div>
                <StudentTrend rows={data.studentTrend} range={evidenceRange} />
              </ModuleSection>

              <ModuleSection id="question-coverage" eyebrow="模块三 · 题库证据" title="题库覆盖" description="正式题目与知识点覆盖情况；题库统计不随日期范围虚构变化。">
                <div className={styles.metricGrid}>
                  <MetricCard label="正式题目" value={countText(data.questionBank.total)} range="正式题库当前记录" source="questions.status='active'" definition="状态为 active 的正式题目数量；未校对或不存在的题目不计入。" />
                  <MetricCard label="知识点覆盖率" value={formatPercentage(data.questionBank.coverageRate)} range="正式题库当前记录" source="questions.knowledge_points" definition="已标注知识点的正式题目数 ÷ 正式题目总数；分母为 0 时显示数据不足。" />
                </div>
                <DifficultyList rows={difficulty} range={evidenceRange} />
                {frequent.length > 0 && <div className={styles.dataBlock}><p className={styles.listTitle}>常用题目</p><p className={styles.evidence}><b>统计范围：</b>正式题库当前记录；<b>数据来源：</b>questions.use_count。</p><ul className={styles.dataList} aria-label="常用题目列表">{frequent.map((row, index) => <li className={styles.dataRow} key={`${String(row.id)}-${index}`}><span>{String(row.stem || "题干未记录")}</span><strong>{countText(row.useCount)}</strong><em>次使用</em></li>)}</ul></div>}
              </ModuleSection>
            </div>

            <ModuleSection id="homework-trend" eyebrow="模块四 · 过程变化" title="作业趋势" description="按课时日期列出作业提交完成情况；不把单个数据点包装成趋势。">
              <HomeworkTrend rows={data.homeworkTrend} range={evidenceRange} />
            </ModuleSection>

            <ModuleSection id="teacher-growth" eyebrow="模块五 · 教师成长" title="教师成长" description="反思记录中的动作、策略和重复问题；没有证据时保留数据不足。">
              <div className={styles.metricGrid}>
                <MetricCard label="反思数量" value={countText(data.growth.reflections)} range={evidenceRange} source="reflections.date" definition="所选范围内的私密教学反思数量。" />
                <MetricCard label="改进动作完成率" value={formatPercentage(data.growth.actionRate)} range={evidenceRange} source="reflections.action_completed" definition="已完成改进动作的反思数 ÷ 全部反思数；分母为 0 时显示数据不足。" />
                <MetricCard label="沉淀教学策略" value={countText(data.growth.strategies)} range={evidenceRange} source="reflections.is_strategy" definition="标记为可复用教学策略的反思数量。" />
                <MetricCard label="重复问题记录" value={countText(repeatedProblems.length)} range={evidenceRange} source="reflections.difficulties" definition="仅统计完全相同且出现次数大于 1 的困难记录；没有重复证据时显示数据不足。" />
              </div>
              <RepeatedProblems rows={repeatedProblems} range={evidenceRange} />
              <KnowledgeList rows={knowledgeMastery} range={evidenceRange} />
            </ModuleSection>
          </>
        )}
      </div>
    </AppShell>
  );
}
