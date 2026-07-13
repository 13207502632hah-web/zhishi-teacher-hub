type FeedbackInput = Record<string, unknown>;

const clean = (value: unknown) => String(value || "").trim();
const sentence = (label: string, value: unknown) => clean(value) ? `${label}${clean(value).replace(/[。；;]+$/, "")}。` : "";

export function generateFeedback(input: FeedbackInput, mode: "short" | "standard", audience: "private" | "group") {
  const student = clean(input.studentName) || "孩子";
  const date = clean(input.lessonDate);
  const time = [clean(input.startTime), clean(input.endTime)].filter(Boolean).join("—");
  const lessonTime = [date, time].filter(Boolean).join(" ");
  const opening = clean(input.opening) || (audience === "group" ? `各位家长好，${lessonTime ? `${lessonTime}的` : "本次"}课程已完成。` : `家长您好，${lessonTime ? `${lessonTime}，` : ""}${student}完成了本次课程。`);
  const content = sentence("本节课主要学习了", input.learningContent);
  const previous = sentence(audience === "group" ? "课前作业整体完成情况：" : "上次作业完成情况：", input.previousHomework);
  const performance = sentence(audience === "group" ? "课堂整体表现：" : "课堂表现：", input.classPerformance || input.highlights);
  const weak = sentence(audience === "group" ? "目前需要共同巩固的是" : "目前比较薄弱的是", input.weakPoints || input.consolidate);
  const advice = sentence("建议", input.parentAdvice);
  const homework = sentence("本节课作业：", input.homeworkRequirements);
  const due = clean(input.dueAt) ? `请于${clean(input.dueAt).replace("T", " ")}前提交。` : "";
  const next = sentence("下节课将重点关注", input.nextFocus);
  const extra = sentence("补充说明：", input.customInput);
  const closing = clean(input.closing) || (audience === "group" ? "请家长提醒孩子按要求完成，有问题可以及时沟通。" : "后续我会继续关注学习情况，也请家长协助提醒按时完成和订正。");
  const essentials = [opening, content, performance, weak, homework, due].filter(Boolean);
  if (mode === "short") return [...essentials, closing].join("");
  return [[opening, previous, content, performance].filter(Boolean).join(""), [weak, advice, homework, due, next, extra].filter(Boolean).join(""), closing].filter(Boolean).join("\n\n");
}
