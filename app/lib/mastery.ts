export type MasteryInputs = {
  assessmentAverage?: number | null;
  homeworkCompletionRate?: number | null;
  understandingAverage?: number | null;
  wrongQuestionMasteryRate?: number | null;
};

type ComponentDefinition = { key: keyof MasteryInputs; label: string; weight: number; normalize: (value: number) => number; explanation: string };

const definitions: ComponentDefinition[] = [
  { key: "assessmentAverage", label: "测验成绩", weight: 0.4, normalize: (value) => value, explanation: "最近已录入测验的平均得分，按 40% 基础权重计算" },
  { key: "homeworkCompletionRate", label: "作业完成", weight: 0.2, normalize: (value) => value * 100, explanation: "已完成作业占全部作业提交记录的比例，按 20% 基础权重计算" },
  { key: "understandingAverage", label: "课堂理解", weight: 0.2, normalize: (value) => value / 5 * 100, explanation: "教师在已完成课时中的理解度评分，按 20% 基础权重计算" },
  { key: "wrongQuestionMasteryRate", label: "错题巩固", weight: 0.2, normalize: (value) => value * 100, explanation: "已标记掌握的错题占全部错题的比例，按 20% 基础权重计算" },
];

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function calculateMastery(inputs: MasteryInputs) {
  const available = definitions.filter(({ key }) => Number.isFinite(inputs[key]));
  const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
  if (!available.length || !totalWeight) return { score: null, components: [], explanation: "暂无足够记录；录入测验、作业、课堂理解度或错题掌握状态后计算。" };
  const components = available.map((item) => {
    const raw = Number(inputs[item.key]);
    const normalized = clamp(item.normalize(raw));
    const effectiveWeight = item.weight / totalWeight;
    return { key: item.key, label: item.label, raw, normalized: Math.round(normalized), effectiveWeight: Math.round(effectiveWeight * 100), contribution: normalized * effectiveWeight, explanation: item.explanation };
  });
  return { score: Math.round(components.reduce((sum, item) => sum + item.contribution, 0)), components, explanation: "仅使用已有真实记录；缺失项不会按零分处理，其余权重会按比例重新分配。" };
}
