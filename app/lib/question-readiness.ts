type ReviewQuestion = Record<string, unknown>;

const text = (value: unknown) => String(value || "").trim();
const hasList = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  const raw = text(value); if (!raw || raw === "[]") return false;
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed); } catch { return true; }
};

export function questionReadinessIssues(item: ReviewQuestion, options: { requireReviewed?: boolean; duplicate?: boolean } = {}) {
  const type = text(item.questionType ?? item.question_type), objective = ["单选题", "多选题", "判断题"].includes(type), issues: string[] = [];
  if (options.requireReviewed && !item.reviewed) issues.push("尚未人工确认");
  if (!text(item.stem)) issues.push("缺少题干");
  if (!text(item.answer)) issues.push("缺少答案");
  if (!text(item.knowledgePoints ?? item.knowledge_points)) issues.push("缺少知识点");
  if (objective && type !== "判断题" && !text(item.options)) issues.push("缺少选项");
  if (!objective && !(hasList(item.scoringPoints ?? item.scoring_points) || text(item.answerPoints ?? item.answer_points) || text(item.analysis))) issues.push("主观题缺少采分点或解析");
  if (Number(item.parseConfidence ?? item.parse_confidence ?? 1) < .7) issues.push("识别置信度低");
  if (options.duplicate) issues.push("疑似重复");
  return issues;
}

