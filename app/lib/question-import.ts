export type ImportedQuestion = Record<string, unknown> & {
  stem: string;
  questionType: string;
  difficulty: number;
  status: "review";
  reviewed: boolean;
  importNotes: string[];
};

type ImportMeta = Record<string, unknown>;

const marker = (text: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`【${escaped}】\\s*([\\s\\S]*?)(?=\\n\\s*【[^】]+】|$)`))?.[1]?.trim() || "";
};

function questionTypeFromHeading(heading: string, hasOptions: boolean) {
  if (/多选|不定项/.test(heading)) return "多选题";
  if (/辨析/.test(heading)) return "辨析题";
  if (/材料|主观|简答|论述|探究/.test(heading)) return "材料题";
  if (/组合/.test(heading)) return "组合题";
  return hasOptions ? "单选题" : "材料题";
}

/** 将常见组卷 Word 的文字内容整理为“待校对”题目；不对题目作自动判定。 */
export function parsePoliticsDocx(text: string, meta: ImportMeta): ImportedQuestion[] {
  const normalized = text.replace(/\r/g, "").replace(/[\u00a0\u3000]/g, " ").replace(/\t/g, " ");
  const sections = normalized.split(/(?=^\s*[一二三四五六七八九十]+、)/m);
  const output: ImportedQuestion[] = [];

  for (const section of sections) {
    const heading = section.match(/^\s*([一二三四五六七八九十]+、[^\n]+)/m)?.[1] || "";
    const chunks = section.split(/(?=^\s*\d{1,3}[．.、]\s*)/m);
    for (const chunk of chunks) {
      const number = chunk.match(/^\s*(\d{1,3})[．.、]\s*/m)?.[1];
      if (!number) continue;
      const beforeAnswer = chunk.split(/【答案】/)[0].replace(/^\s*\d{1,3}[．.、]\s*/, "").trim();
      const optionStart = beforeAnswer.match(/(?:^|\n)\s*A[．.、][\s\S]*$/m)?.[0]?.trim() || "";
      const stem = (optionStart ? beforeAnswer.slice(0, beforeAnswer.lastIndexOf(optionStart)) : beforeAnswer).trim();
      const options = optionStart;
      const rawDifficulty = Number(marker(chunk, "难度"));
      // 常见题库的难度系数越高代表越容易，转成 1（容易）到 5（较难）的教学标记。
      const difficulty = rawDifficulty >= .9 ? 1 : rawDifficulty >= .8 ? 2 : rawDifficulty >= .7 ? 3 : rawDifficulty >= .6 ? 4 : rawDifficulty > 0 ? 5 : 3;
      const answer = marker(chunk, "答案");
      const analysis = marker(chunk, "详解") || marker(chunk, "解析");
      const knowledgePoints = marker(chunk, "知识点");
      if (!stem) continue;
      const importNotes = [!answer && "缺少答案", !knowledgePoints && "缺少知识点", !analysis && "缺少解析"].filter(Boolean) as string[];
      output.push({
        ...meta,
        stem,
        options,
        answer,
        analysis,
        knowledgePoints,
        questionType: questionTypeFromHeading(heading, Boolean(options)),
        difficulty,
        status: "review",
        reviewed: false,
        importNotes,
        source: meta.source || "Word 试卷导入",
      });
    }
  }
  return output;
}

export function summarizeImport(questions: ImportedQuestion[]) {
  const typeCounts = questions.reduce<Record<string, number>>((counts, question) => {
    counts[question.questionType] = (counts[question.questionType] || 0) + 1;
    return counts;
  }, {});
  return {
    total: questions.length,
    answered: questions.filter((question) => Boolean(question.answer)).length,
    tagged: questions.filter((question) => Boolean(question.knowledgePoints)).length,
    explained: questions.filter((question) => Boolean(question.analysis)).length,
    incomplete: questions.filter((question) => question.importNotes.length > 0).length,
    typeCounts,
  };
}
