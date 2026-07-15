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

type SeparatedAnswer = { answer: string; analysis: string; knowledgePoints: string };

/** 识别“前半部分题目、后半部分参考答案与详解”的常见组卷结构。 */
function splitSeparatedAnswers(text: string) {
  const answerHeading = text.search(/^\s*(?:《[^\n》]+》\s*)?参考答案(?:与解析)?\s*$/m);
  if (answerHeading < 0) return { questionText: text, answers: new Map<string, SeparatedAnswer>() };
  const questionText = text.slice(0, answerHeading).trim();
  const answerText = text.slice(answerHeading);
  const detailedStart = answerText.search(/^[ \t]*\d{1,3}[．.、][ \t]*(?:[A-H]+|正确|错误)(?:[ \t]+\d{1,3}[．.、][ \t]*(?:[A-H]+|正确|错误))*[ \t]*$/m);
  const detailedText = detailedStart >= 0 ? answerText.slice(detailedStart) : "";
  const answers = new Map<string, SeparatedAnswer>();
  for (const chunk of detailedText.split(/(?=^[ \t]*\d{1,3}[．.、][ \t]*(?:[A-H]+|正确|错误)[ \t]*$)/m)) {
    const heading = chunk.match(/^[ \t]*(\d{1,3})[．.、][ \t]*([A-H]+|正确|错误)[ \t]*$/m);
    if (!heading) continue;
    answers.set(heading[1], {
      answer: heading[2],
      analysis: marker(chunk, "详解") || marker(chunk, "解析"),
      knowledgePoints: marker(chunk, "知识点"),
    });
  }
  // 连续小题有时共用一组知识点与详解，答案会写成“27．B  28．C  29．A  30．D”。
  for (const lineMatch of detailedText.matchAll(/^([^\n]+)$/gm)) {
    const pairs = [...lineMatch[1].matchAll(/(\d{1,3})[．.、][ \t]*([A-H]+)/g)];
    if (pairs.length < 2) continue;
    const restStart = (lineMatch.index || 0) + lineMatch[0].length;
    const remaining = detailedText.slice(restStart);
    const nextStandalone = remaining.search(/^[ \t]*\d{1,3}[．.、][ \t]*(?:[A-H]+|正确|错误)[ \t]*$/m);
    const groupChunk = detailedText.slice(lineMatch.index || 0, nextStandalone < 0 ? undefined : restStart + nextStandalone);
    const knowledgePoints = marker(groupChunk, "知识点");
    const analysisBlock = marker(groupChunk, "详解") || marker(groupChunk, "解析");
    for (const pair of pairs) {
      const number = pair[1];
      const analysisPattern = new RegExp(`(?:^|\\n)[ \\t]*${number}[．.、][ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\d{1,3}[．.、]|$)`);
      const analysis = analysisBlock.match(analysisPattern)?.[1]?.trim() || analysisBlock;
      answers.set(number, { answer: pair[2], analysis, knowledgePoints });
    }
  }
  return { questionText, answers };
}

/** 将常见组卷 Word 的文字内容整理为“待校对”题目；不对题目作自动判定。 */
export function parsePoliticsDocx(text: string, meta: ImportMeta): ImportedQuestion[] {
  const normalized = text.replace(/\r/g, "").replace(/[\u00a0\u3000]/g, " ").replace(/\t/g, " ")
    .split("\n").filter((line) => !/^\s*(第\s*\d+\s*页(?:\s*共\s*\d+\s*页)?|—?\s*\d+\s*—?|仅供测试使用)\s*$/.test(line)).join("\n");
  const { questionText, answers: separatedAnswers } = splitSeparatedAnswers(normalized);
  const sections = questionText.split(/(?=^\s*[一二三四五六七八九十]+、)/m);
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
      const separated = separatedAnswers.get(number);
      const answer = marker(chunk, "答案") || separated?.answer || "";
      const analysis = marker(chunk, "详解") || marker(chunk, "解析") || separated?.analysis || "";
      const knowledgePoints = marker(chunk, "知识点") || separated?.knowledgePoints || "";
      if (!stem) continue;
      const importNotes = [!answer && "【存疑】缺少答案", !knowledgePoints && "【存疑】缺少知识点", !analysis && "【存疑】缺少解析"].filter(Boolean) as string[];
      const subQuestions = [...questionBody.matchAll(/[（(](\d+)[）)]\s*([^（(]+?)(?=[（(]\d+[）)]|$)/g)].map((match) => ({ number: match[1], prompt: match[2].trim(), answer: "", scoringPoints: [] }));
      const parseConfidence = Math.max(.35, 1 - importNotes.length * .15 - (subQuestions.length > 1 && !marker(chunk, "采分点") ? .1 : 0));
      output.push({
        ...meta,
        sourceQuestionNumber: Number(number),
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
        valueJudgment: marker(chunk, "价值判断"),
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

function decodeHtml(value: string) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function textFromHtml(value: string) {
  return decodeHtml(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  return [];
}

/** 将 Mammoth HTML 中的图片和表格按前邻题号归位；位置无法判断时明确标为“【存疑】”。 */
export function enrichQuestionsFromHtml(html: string, input: ImportedQuestion[]) {
  if (!input.length || (!/<img\b/i.test(html) && !/<table\b/i.test(html))) return input;
  const output = input.map((question) => ({ ...question, attachments: [...arrayValue(question.attachments)], tables: [...arrayValue(question.tables)], importNotes: [...question.importNotes] }));
  const blocks = html.match(/<table\b[\s\S]*?<\/table>|<p\b[\s\S]*?<\/p>|<img\b[^>]*>/gi) || [];
  let current = -1, imageIndex = 0, tableIndex = 0;
  for (const block of blocks) {
    const isTable = /^<table\b/i.test(block), text = textFromHtml(block);
    if (!isTable && /参考答案(?:与解析)?/.test(text)) break;
    if (!isTable && /^\s*\d{1,3}[．.、]\s*/.test(text)) current = Math.min(current + 1, output.length - 1);
    const target = current >= 0 ? current : 0, uncertain = current < 0;
    const images = [...block.matchAll(/<img\b[^>]*\bsrc=["']([^"']*)["'][^>]*>/gi)];
    for (const match of images) {
      imageIndex += 1;
      const alt = match[0].match(/\balt=["']([^"']*)["']/i)?.[1];
      (output[target].attachments as unknown[]).push({ id: `image-${imageIndex}`, src: match[1] || "", alt: decodeHtml(alt || `原试卷图片 ${imageIndex}`), needsReview: true, uncertainPosition: uncertain });
    }
    if (isTable) {
      tableIndex += 1;
      const rows = [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) => [...row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => textFromHtml(cell[1])));
      (output[target].tables as unknown[]).push({ id: `table-${tableIndex}`, rows, needsReview: true, uncertainPosition: uncertain });
    }
  }
  return output.map((question) => {
    const attachments = question.attachments as unknown[], tables = question.tables as unknown[];
    if (!attachments.length && !tables.length) return question;
    const uncertain = [...attachments, ...tables].some((item) => Boolean((item as { uncertainPosition?: boolean }).uncertainPosition));
    return { ...question, parseConfidence: Math.min(question.parseConfidence, uncertain ? .55 : .75), importNotes: [...question.importNotes, attachments.length ? `含 ${attachments.length} 张图片，需核对位置` : "", tables.length ? `含 ${tables.length} 个表格，需核对结构` : "", uncertain ? "【存疑】图片或表格位于首道已识别题号之前，暂归入第一题" : ""].filter(Boolean) };
  });
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
