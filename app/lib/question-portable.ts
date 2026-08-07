export const PORTABLE_COLUMNS = ["stem", "material", "options", "answer", "analysis", "questionType", "difficulty", "score", "stage", "grade", "textbookVersion", "volume", "unit", "topic", "knowledgePoints", "secondaryKnowledge", "coreCompetencies", "abilityLevel", "source", "year", "region", "examType", "tags"] as const;

const extraHeaders = new Set(["sourceQuestionNumber", "sourceFile"]);
const headerAliases: Record<string, string> = {
  题号: "sourceQuestionNumber",
  题干: "stem",
  材料: "material",
  选项: "options",
  答案: "answer",
  解析: "analysis",
  题型: "questionType",
  难度: "difficulty",
  分值: "score",
  学段: "stage",
  年级: "grade",
  教材版本: "textbookVersion",
  册别: "volume",
  单元: "unit",
  课题: "topic",
  知识点: "knowledgePoints",
  二级知识点: "secondaryKnowledge",
  核心素养: "coreCompetencies",
  能力层级: "abilityLevel",
  来源: "source",
  来源文件: "sourceFile",
  年份: "year",
  地区: "region",
  考试类型: "examType",
  标签: "tags",
};

const normalizeHeader = (header: string) => {
  const trimmed = header.replace(/^\uFEFF/, "").trim();
  if (headerAliases[trimmed]) return headerAliases[trimmed];
  const mapped = trimmed.toLowerCase();
  const canonical = PORTABLE_COLUMNS.find((column) => column.toLowerCase() === mapped) || [...extraHeaders].find((column) => column.toLowerCase() === mapped);
  return canonical || "";
};

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function quoteCsvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function parseQuestionCsv(text: string): Array<Record<string, unknown>> {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) => ({ name: normalizeHeader(header), index })).filter((item) => item.name);
  if (!headers.length) return [];
  return rows.slice(1).map((row) => {
    const item: Record<string, unknown> = {};
    for (const header of headers) item[header.name] = row[header.index] ?? "";
    return item;
  }).filter((item) => String(item.stem || "").trim());
}

export const portableTemplateExample = (): Record<string, unknown> => ({
  stem: "示例题干：全过程人民民主是最广泛、最真实、最管用的民主。",
  material: "示例材料：某社区通过居民议事会讨论公共事务。",
  options: "A．人民当家作主\nB．资本决定政治\nC．权力集中统一\nD．少数服从多数",
  answer: "A",
  analysis: "示例解析：全过程人民民主强调人民是国家的主人，A 符合题意。",
  questionType: "单选题",
  difficulty: 3,
  score: 3,
  stage: "高中",
  grade: "高一",
  textbookVersion: "统编版",
  volume: "必修3 政治与法治",
  unit: "第三单元 全面依法治国",
  topic: "9.1 科学立法",
  knowledgePoints: "全过程人民民主",
  secondaryKnowledge: "",
  coreCompetencies: "政治认同",
  abilityLevel: "理解",
  source: "示例：某市 2026 年高一期末",
  year: 2026,
  region: "示例：某市",
  examType: "期末考试",
  tags: "示例标签",
  sourceQuestionNumber: 1,
});

export function portableTemplateCsv() {
  const headers = [...PORTABLE_COLUMNS, "sourceQuestionNumber"];
  const example = portableTemplateExample();
  return `\uFEFF${headers.join(",")}\r\n${headers.map((header) => quoteCsvCell(example[header])).join(",")}`;
}

export function portableTemplateJson() {
  return {
    schema: "zhishi-question-bank/v1",
    version: 1,
    template: true,
    columns: [...PORTABLE_COLUMNS, "sourceQuestionNumber"],
    instructions: "将 questions 数组中的示例替换为真实题目；导入后全部进入待校对，不会直接进入正式题库。",
    questions: [portableTemplateExample()],
  };
}
