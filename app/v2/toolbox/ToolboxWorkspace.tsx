"use client";

import Link from "../../components/HardNavigationLink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ClassRow = { id: number; name: string; grade?: string; studentCount?: number };
type Member = { id: number; name: string; nickname?: string; grade?: string };
type Question = { id: number; prompt: string; answer: number };
type Operator = "+" | "-" | "×" | "÷";

async function requestJson(path: string) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error || `请求失败（${response.status}）`));
  return payload;
}

function randomInt(maxExclusive: number) {
  if (maxExclusive <= 1) return 0;
  const range = 0x100000000, limit = range - range % maxExclusive, values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % maxExclusive;
}

function buildQuestion(id: number, operator: Operator, difficulty: number): Question {
  const addLimit = [20, 100, 1000][difficulty - 1], factorLimit = [9, 12, 25][difficulty - 1];
  if (operator === "+") {
    const a = randomInt(addLimit + 1), b = randomInt(addLimit + 1);
    return { id, prompt: `${a} + ${b} =`, answer: a + b };
  }
  if (operator === "-") {
    const first = randomInt(addLimit + 1), second = randomInt(addLimit + 1), a = Math.max(first, second), b = Math.min(first, second);
    return { id, prompt: `${a} - ${b} =`, answer: a - b };
  }
  if (operator === "×") {
    const a = randomInt(factorLimit) + 1, b = randomInt(factorLimit) + 1;
    return { id, prompt: `${a} × ${b} =`, answer: a * b };
  }
  const divisor = randomInt(factorLimit) + 1, quotient = randomInt(factorLimit) + 1;
  return { id, prompt: `${divisor * quotient} ÷ ${divisor} =`, answer: quotient };
}

export function ToolboxWorkspace() {
  const [classes, setClasses] = useState<ClassRow[]>([]), [classId, setClassId] = useState(0), [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true), [memberLoading, setMemberLoading] = useState(false), [error, setError] = useState("");
  const [picked, setPicked] = useState<Member | null>(null), [pickedIds, setPickedIds] = useState<number[]>([]), [history, setHistory] = useState<Member[]>([]), [excludePicked, setExcludePicked] = useState(true), [rolling, setRolling] = useState(false);
  const rollTimer = useRef<number | null>(null);
  const [operators, setOperators] = useState<Operator[]>(["+", "-"]), [difficulty, setDifficulty] = useState(1), [questionCount, setQuestionCount] = useState(10);
  const [questions, setQuestions] = useState<Question[]>([]), [answers, setAnswers] = useState<Record<number, string>>({}), [graded, setGraded] = useState(false);

  const loadClasses = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await requestJson("/api/v2/classes?status=active&pageSize=200"), rows = (payload.classes || []) as ClassRow[];
      setClasses(rows); setClassId((current) => current && rows.some((row) => Number(row.id) === current) ? current : Number(rows[0]?.id || 0));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "班级读取失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadClasses(); }, [loadClasses]);
  useEffect(() => {
    if (!classId) { setMembers([]); return; }
    let active = true; setMemberLoading(true); setError("");
    requestJson(`/api/v2/classes/${classId}`).then((payload) => { if (active) { setMembers((payload.members || []) as Member[]); setPicked(null); setPickedIds([]); setHistory([]); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "班级成员读取失败"); }).finally(() => { if (active) setMemberLoading(false); });
    return () => { active = false; };
  }, [classId]);
  useEffect(() => () => { if (rollTimer.current != null) window.clearInterval(rollTimer.current); }, []);

  const available = useMemo(() => excludePicked ? members.filter((member) => !pickedIds.includes(Number(member.id))) : members, [excludePicked, members, pickedIds]);
  const score = useMemo(() => questions.reduce((total, question) => total + (Number(answers[question.id]) === question.answer ? 1 : 0), 0), [answers, questions]);

  function drawStudent() {
    if (rolling || !available.length) return;
    setRolling(true); let ticks = 0;
    rollTimer.current = window.setInterval(() => {
      const candidate = available[randomInt(available.length)]; setPicked(candidate); ticks += 1;
      if (ticks < 11) return;
      if (rollTimer.current != null) window.clearInterval(rollTimer.current); rollTimer.current = null;
      setRolling(false); setPickedIds((current) => [...new Set([...current, Number(candidate.id)])]); setHistory((current) => [candidate, ...current].slice(0, 12));
    }, 65);
  }

  function resetDraw() { setPicked(null); setPickedIds([]); setHistory([]); }
  function toggleOperator(operator: Operator) { setOperators((current) => current.includes(operator) ? current.length === 1 ? current : current.filter((item) => item !== operator) : [...current, operator]); setGraded(false); }
  function generateQuestions() {
    const next = Array.from({ length: questionCount }, (_, index) => buildQuestion(index + 1, operators[randomInt(operators.length)], difficulty));
    setQuestions(next); setAnswers({}); setGraded(false);
  }
  function printQuestions() {
    document.body.classList.add("v2-toolbox-printing"); window.print(); window.setTimeout(() => document.body.classList.remove("v2-toolbox-printing"), 300);
  }

  return <>{error && <p className="v2-alert v2-error">{error}</p>}<section className="v2-toolbox-grid">
    <article className={`v2-card v2-roll-call ${loading || memberLoading ? "v2-loading" : ""}`} id="roll-call"><header className="v2-card-head"><div><h2>点兵点将</h2><p>名单来自当前班级，不另存学生数据</p></div><em className="v2-status completed">{members.length} 人</em></header><div className="v2-form-pair"><label>选择班级<select value={classId} onChange={(event) => setClassId(Number(event.target.value))}><option value={0}>请选择班级</option>{classes.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.grade || "年级未填"}</option>)}</select></label><label className="v2-check"><input type="checkbox" checked={excludePicked} onChange={(event) => setExcludePicked(event.target.checked)}/>本轮不重复点到</label></div><div className={`v2-picked-student ${rolling ? "rolling" : ""}`}><small>{rolling ? "正在抽取" : picked ? "本次选中" : "准备就绪"}</small><b>{picked?.name || (members.length ? "点击下方按钮" : "当前班级暂无学生")}</b><span>{picked ? `${picked.nickname || "未填昵称"} · ${picked.grade || "年级未填"}` : "每一轮可重置；抽取结果不写入学生档案"}</span></div><div className="v2-detail-actions"><button className="v2-primary" disabled={rolling || !available.length} onClick={drawStudent}>{rolling ? "抽取中…" : available.length ? "随机点一名学生" : "本轮已全部点到"}</button><button className="v2-secondary-on-light" disabled={!history.length || rolling} onClick={resetDraw}>重置本轮</button></div><div className="v2-roll-history"><b>本轮记录</b>{history.length ? <div>{history.map((member, index) => <span key={`${member.id}-${index}`}>{history.length - index}. {member.name}</span>)}</div> : <small>还没有点名记录</small>}</div></article>
    <article className="v2-card v2-arithmetic-card" id="arithmetic"><header className="v2-card-head"><div><h2>口算检测</h2><p>本机生成整数题，除法保证整除</p></div>{graded && <em className={`v2-status ${score === questions.length ? "completed" : "warning"}`}>{score}/{questions.length} 正确</em>}</header><div className="v2-arithmetic-settings"><label>题量<select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}><option value={10}>10 题</option><option value={20}>20 题</option><option value={30}>30 题</option></select></label><label>难度<select value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}><option value={1}>基础</option><option value={2}>进阶</option><option value={3}>挑战</option></select></label><fieldset><legend>运算</legend>{(["+", "-", "×", "÷"] as Operator[]).map((operator) => <label key={operator}><input type="checkbox" checked={operators.includes(operator)} onChange={() => toggleOperator(operator)}/>{operator}</label>)}</fieldset><button className="v2-primary" onClick={generateQuestions}>生成新题</button></div>{questions.length ? <><div className="v2-arithmetic-sheet">{questions.map((question) => { const correct = Number(answers[question.id]) === question.answer; return <label key={question.id} className={graded ? correct ? "correct" : "incorrect" : ""}><span>{question.id}. {question.prompt}</span><input inputMode="numeric" aria-label={`第 ${question.id} 题答案`} value={answers[question.id] || ""} onChange={(event) => { setAnswers((current) => ({ ...current, [question.id]: event.target.value })); setGraded(false); }}/>{graded && <em>{correct ? "✓" : `答案 ${question.answer}`}</em>}</label>; })}</div><div className="v2-detail-actions v2-arithmetic-actions"><button className="v2-primary" onClick={() => setGraded(true)}>立即判分</button><button className="v2-secondary-on-light" onClick={printQuestions}>打印题目</button><span>{graded ? `正确 ${score} 题，错误 ${questions.length - score} 题` : `已填写 ${Object.values(answers).filter((item) => item.trim()).length}/${questions.length}`}</span></div></> : <div className="v2-empty"><b>还没有口算题</b>选择题量、难度与运算后生成。</div>}</article>
    <article className="v2-card v2-tool-links"><header className="v2-card-head"><div><h2>课件与教案入口</h2><p>统一进入现有资料和备课工作流</p></div></header><div className="v2-action-list"><Link href="/v2/class-files"><i>盘</i><span><b>班级网盘</b><small>上传课件、讲义和示范音频，确认后发给班级</small></span><em>打开</em></Link><Link href="/v2/modules/resources"><i>资</i><span><b>资源中心</b><small>整理私有备课素材、教学策略和外部链接</small></span><em>打开</em></Link><Link href="/v2/modules/students"><i>课</i><span><b>课时与班级</b><small>从真实班级、学生和课时进入备课上下文</small></span><em>打开</em></Link><Link href="/v2/assistant"><i>✦</i><span><b>智能备课助手</b><small>基于工作室证据起草教案，正式动作仍需确认</small></span><em>打开</em></Link></div></article>
  </section></>;
}
