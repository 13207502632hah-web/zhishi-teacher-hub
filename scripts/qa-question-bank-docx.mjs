import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const font = "STHeiti", output = new URL("../.artifacts/question-bank/", import.meta.url), image = await readFile(new URL("../public/og.png", import.meta.url));
const text = (value, options = {}) => new TextRun({ text: value, font, size: 22, ...options });
const paragraph = (value, options = {}) => new Paragraph({ children: [text(value)], spacing: { after: 100 }, ...options });

function documentFor(mode) {
  const answer = mode === "analysis";
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [text("满分道法·政治题库回归试卷", { bold: true, size: 34 })], spacing: { after: 220 } }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [text("姓名：________  班级：________  日期：________  总分：20分", { size: 21 })], spacing: { after: 220 } }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("一、选择题", { bold: true, size: 26 })], keepNext: true }),
    new Paragraph({ children: [text("材料：某校围绕全过程人民民主开展项目式学习，学生通过问卷、访谈和议事会提出校园治理建议。")], shading: { fill: "F4F6EF" }, keepNext: true }),
    paragraph("1．全过程人民民主的本质是（3分）", { keepNext: true }),
    paragraph("A．人民当家作主"), paragraph("B．少数人决定公共事务"), paragraph("C．资本支配国家权力"), paragraph("D．取消一切社会差异"),
    ...(answer ? [paragraph("答案：A", { children: [text("答案：A", { bold: true })] }), paragraph("解析：党的领导、人民当家作主、依法治国有机统一，人民当家作主是社会主义民主政治的本质和核心。"), paragraph("知识点：全过程人民民主")] : [paragraph("____________________________________________________________________________"), paragraph("____________________________________________________________________________")]),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: image, type: "png", transformation: { width: 400, height: 210 }, altText: { title: "题目配图", description: "用于检查 Word 图片排版", name: "题目配图" } })], spacing: { after: 140 } }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("二、材料分析题", { bold: true, size: 26 })], keepNext: true }),
    paragraph("2．根据下表信息，说明法治政府建设的要求。（7分）", { keepNext: true }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: ["观察维度", "材料信息", "教材观点"].map((cell) => new TableCell({ children: [paragraph(cell)] })) }), new TableRow({ children: ["权力运行", "公开行政流程", "规范公正文明执法"].map((cell) => new TableCell({ children: [paragraph(cell)] })) })] }),
    ...(answer ? [paragraph("答案：坚持依法行政，全面推进政务公开，严格规范公正文明执法。", { children: [text("答案：坚持依法行政，全面推进政务公开，严格规范公正文明执法。", { bold: true })] }), paragraph("解析：先概括材料中的政府行为，再对应依法行政、政务公开和规范执法等教材观点。"), paragraph("知识点：法治政府")] : [paragraph("____________________________________________________________________________"), paragraph("____________________________________________________________________________"), paragraph("____________________________________________________________________________")]),
    new Paragraph({ pageBreakBefore: true, heading: HeadingLevel.HEADING_1, children: [text("三、规范表述检查", { bold: true, size: 26 })] }),
    paragraph("3．运用政治与法治知识，说明坚持党的领导、人民当家作主、依法治国有机统一的意义。（10分）"),
    ...(answer ? [paragraph("答案：三者统一于我国社会主义民主政治伟大实践。党的领导是根本保证，人民当家作主是本质和核心，依法治国是基本方略。", { children: [text("答案：三者统一于我国社会主义民主政治伟大实践。党的领导是根本保证，人民当家作主是本质和核心，依法治国是基本方略。", { bold: true })] }), paragraph("解析：按照观点—关系—意义组织答案，避免脱离材料堆砌术语。"), paragraph("知识点：党的领导、人民当家作主、依法治国有机统一")] : Array.from({ length: 6 }, () => paragraph("____________________________________________________________________________"))),
  ];
  return new Document({ styles: { default: { document: { run: { font, size: 22 }, paragraph: { spacing: { line: 360 } } } } }, sections: [{ properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children }] });
}

await mkdir(output, { recursive: true });
for (const mode of ["student", "analysis"]) await writeFile(new URL(`question-bank-${mode}.docx`, output), await Packer.toBuffer(documentFor(mode)));
console.log(new URL("question-bank-student.docx", output).pathname);
console.log(new URL("question-bank-analysis.docx", output).pathname);
