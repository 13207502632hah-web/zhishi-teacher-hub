export type ParsedFeedback = {
  studentName: string;
  studentId: number | null;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  actualContent: string;
  homework: string;
  nextPlan: string;
  confidence: number;
  evidence: Array<{ field: string; excerpt: string; confidence: number }>;
};

const lineValue = (text: string, labels: string[]) => {
  for (const label of labels) { const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[：:]\\s*([^\\n]+)`, "i")); if (match) return match[1].trim(); }
  return "";
};
const pad = (value: string) => value.padStart(2, "0");

export function parseFeedbackText(source: string, students: Array<{ id: number; name: string }>, now = new Date()) {
  const text = String(source || "").replace(/\r/g, "").trim(), evidence: ParsedFeedback["evidence"] = [];
  const student = students.filter((item) => item.name && text.includes(item.name)).sort((a, b) => b.name.length - a.name.length)[0];
  if (student) evidence.push({ field: "studentName", excerpt: student.name, confidence: .98 });
  const dateMatch = text.match(/(?:(20\d{2})[年\-/.])?(\d{1,2})[月\-/.](\d{1,2})日?/), year = dateMatch?.[1] || String(now.getFullYear());
  const date = dateMatch ? `${year}-${pad(dateMatch[2])}-${pad(dateMatch[3])}` : "";
  if (dateMatch) evidence.push({ field: "date", excerpt: dateMatch[0], confidence: dateMatch[1] ? .98 : .78 });
  const timeMatch = text.match(/(\d{1,2})(?:[:：时](\d{1,2}))?\s*(?:-|—|–|~|至)\s*(\d{1,2})(?:[:：时](\d{1,2}))?/), startTime = timeMatch ? `${pad(timeMatch[1])}:${pad(timeMatch[2] || "00")}` : "", endTime = timeMatch ? `${pad(timeMatch[3])}:${pad(timeMatch[4] || "00")}` : "";
  if (timeMatch) evidence.push({ field: "time", excerpt: timeMatch[0], confidence: .95 });
  const location = lineValue(text, ["上课地点", "地点", "授课地点"]), actualContent = lineValue(text, ["课堂内容", "学习内容", "本节内容", "课程内容", "实际完成"]), homework = lineValue(text, ["课后作业", "本节作业", "作业"]), nextPlan = lineValue(text, ["下节计划", "下次课计划", "下节课"]);
  for (const [field, value] of [["location", location], ["actualContent", actualContent], ["homework", homework], ["nextPlan", nextPlan]] as const) if (value) evidence.push({ field, excerpt: value, confidence: .9 });
  const required = [student, date, startTime, endTime].filter(Boolean).length, optional = [location, actualContent, homework, nextPlan].filter(Boolean).length;
  const confidence = Math.round(Math.min(.99, required / 4 * .7 + optional / 4 * .3) * 100) / 100;
  return { studentName: student?.name || "", studentId: student?.id || null, date, startTime, endTime, location, actualContent, homework, nextPlan, confidence, evidence } satisfies ParsedFeedback;
}
