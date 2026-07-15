export function parseAnswerCardOcr(text: string, students: Array<{ id: number; name: string }>, assessments: Array<{ id: number; title: string }>, confidence: number) {
  const clean = String(text || "").replace(/\r/g, ""), student = students.filter((item) => clean.includes(item.name)).sort((a, b) => b.name.length - a.name.length)[0];
  const assessment = assessments.filter((item) => item.title && clean.includes(item.title)).sort((a, b) => b.title.length - a.title.length)[0];
  const examLabel = clean.match(/(?:考试名称|考试|测验)[：:]?\s*([^\n]{2,30})/)?.[1]?.trim() || "";
  const date = clean.match(/(20\d{2})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/)?.slice(1).map((part) => part.padStart(2, "0")).join("-") || "";
  const totalScore = Number(clean.match(/(?:总分|成绩|得分)[：:]?\s*(\d+(?:\.\d+)?)/)?.[1] || 0) || null;
  const items = [...clean.matchAll(/(?:第?\s*)?(\d{1,2})\s*(?:题|[.、:：])\s*(\d+(?:\.\d+)?)\s*(?:分|\/\s*(\d+(?:\.\d+)?))?/g)].slice(0, 100).map((match) => ({ questionNumber: match[1], studentAnswer: "", standardAnswer: "", teacherScore: match[2], maxScore: match[3] || "", knowledgePoints: "", confidence, reviewStatus: "pending" }));
  return { studentId: student?.id || null, studentName: student?.name || "", assessmentId: assessment?.id || null, assessmentTitle: assessment?.title || examLabel, date, totalScore, items: items.length ? items : [{ questionNumber: "1", studentAnswer: "", standardAnswer: "", teacherScore: "", maxScore: "", knowledgePoints: "", confidence: 0, reviewStatus: "pending" }] };
}
