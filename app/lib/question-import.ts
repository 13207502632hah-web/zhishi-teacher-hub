export type ImportedQuestion = Record<string, unknown> & {
  stem: string;
  questionType: string;
  difficulty: number;
  status: "review";
  reviewed: boolean;
  importNotes: string[];
  parseConfidence: number;
  reviewStatus: "pending";
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
  const normalized = text.replace(/\r/g, "").replace(/[\u00a0\u3000]/g, " ").replace(/\t/g, " ")
    .split("\n").filter((line) => !/^\s*(第\s*\d+\s*页(?:\s*共\s*\d+\s*页)?|—?\s*\d+\s*—?|仅供测试使用)\s*$/.test(line)).join("\n");
  const sections = normalized.split(/(?=^\s*[一二三四五六七八九十]+、)/m);
  const output: ImportedQuestion[] = [];

  for (const section of sections) {
    const heading = section.match(/^\s*([一二三四五六七八九十]+、[^\n]+)/m)?.[1] || "";
    const chunks = section.split(/(?=^\s*\d{1,3}[．.、]\s*)/m);
    for (const chunk of chunks) {
      const number = chunk.match(/^\s*(\d{1,3})[．.、]\s*/m)?.[1];
      if (!number) continue;
      const beforeAnswer = chunk.split(/【答案】/)[0].replace(/^\s*\d{1,3}[．.、]\s*/, "").trim();
      const material = marker(chunk, "材料");
      const questionBody = material ? beforeAnswer.replace(/【材料】\s*[\s\S]*?(?=\n\s*【设问】|\n\s*[（(]\d+[）)]|$)/, "").replace(/【设问】\s*/, "").trim() : beforeAnswer;
      const optionStart = questionBody.match(/(?:^|\n)\s*A[．.、][\s\S]*$/m)?.[0]?.trim() || "";
      const stem = (optionStart ? questionBody.slice(0, questionBody.lastIndexOf(optionStart)) : questionBody).trim();
      const options = optionStart.replace(/([^\n])([B-H][．.、])/g, "$1\n$2");
      const rawDifficulty = Number(marker(chunk, "难度"));
      // 常见题库的难度系数越高代表越容易，转成 1（容易）到 5（较难）的教学标记。
      const difficulty = Number.isInteger(rawDifficulty) && rawDifficulty >= 1 && rawDifficulty <= 5 ? rawDifficulty : rawDifficulty >= .9 ? 1 : rawDifficulty >= .8 ? 2 : rawDifficulty >= .7 ? 3 : rawDifficulty >= .6 ? 4 : rawDifficulty > 0 ? 5 : 3;
      const answer = marker(chunk, "答案");
      const analysis = marker(chunk, "详解") || marker(chunk, "解析");
      const knowledgePoints = marker(chunk, "知识点");
      if (!stem) continue;
      const importNotes = [!answer && "缺少答案", !knowledgePoints && "缺少知识点", !analysis && "缺少解析"].filter(Boolean) as string[];
      const subQuestions = [...questionBody.matchAll(/[（(](\d+)[）)]\s*([^（(]+?)(?=[（(]\d+[）)]|$)/g)].map((match) => ({ number: match[1], prompt: match[2].trim(), answer: "", scoringPoints: [] }));
      const parseConfidence = Math.max(.35, 1 - importNotes.length * .15 - (subQuestions.length > 1 && !marker(chunk, "采分点") ? .1 : 0));
      output.push({
        ...meta,
        stem,
        material,
        options,
        answer,
        answerPoints: marker(chunk, "采分点"),
        scoringPoints: marker(chunk, "采分点").split(/[；;\n]/).map((item) => item.trim()).filter(Boolean),
        subQuestions,
        questionGroup: heading,
        attachments: [],
        tables: [],
        parseConfidence,
        reviewStatus: "pending",
        analysis,
        factBasis: marker(chunk, "事实依据"),
        textbookView: marker(chunk, "教材依据") || marker(chunk, "教材观点"),
        answerLogic: marker(chunk, "答题逻辑"),
        standardExpression: marker(chunk, "规范表述"),
        knowledgePoints,
        score: Number(marker(chunk, "分值")) || meta.score || null,
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

/** 将 Mammoth 生成的安全 HTML 中的图片和表格，按出现顺序关联到识别题目。 */
export function enrichQuestionsFromHtml(html: string, input: ImportedQuestion[]) {
  if (typeof DOMParser === "undefined") return input;
  const document = new DOMParser().parseFromString(html, "text/html");
  const attachments = [...document.querySelectorAll("img")].map((image, index) => ({ id: `image-${index + 1}`, src: image.getAttribute("src") || "", alt: image.getAttribute("alt") || `原试卷图片 ${index + 1}`, needsReview: true }));
  const tables = [...document.querySelectorAll("table")].map((table, index) => ({ id: `table-${index + 1}`, rows: [...table.querySelectorAll("tr")].map((row) => [...row.querySelectorAll("th,td")].map((cell) => cell.textContent?.trim() || "")), needsReview: true }));
  if (!attachments.length && !tables.length) return input;
  return input.map((question, index) => index === 0 ? { ...question, attachments, tables, parseConfidence: Math.min(question.parseConfidence, .75), importNotes: [...question.importNotes, attachments.length ? `含 ${attachments.length} 张图片，需核对位置` : "", tables.length ? `含 ${tables.length} 个表格，需核对结构` : ""].filter(Boolean) } : question);
}

export function summarizeImport(questions: Array<Pick<ImportedQuestion, "questionType" | "answer" | "knowledgePoints" | "analysis" | "importNotes"> & { parseConfidence?: number }>) {
  const typeCounts = questions.reduce<Record<string, number>>((counts, question) => {
    counts[question.questionType] = (counts[question.questionType] || 0) + 1;
    return counts;
  }, {});
  return {
    total: questions.length,
    answered: questions.filter((question) => Boolean(question.answer)).length,
    tagged: questions.filter((question) => Boolean(question.knowledgePoints)).length,
    explained: questions.filter((question) => Boolean(question.analysis)).length,
    incomplete: questions.filter((question) => (question.importNotes?.length || 0) > 0).length,
    lowConfidence: questions.filter((question) => Number(question.parseConfidence || 0) < .7).length,
    typeCounts,
  };
}
