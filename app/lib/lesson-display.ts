const text = (value: unknown) => String(value || "").trim();
const clock = (value: unknown) => text(value).replace(/^0(?=\d:)/, "");

export function lessonDisplay(row: Record<string, unknown>) {
  const rawNames = text(row.studentNames ?? row.student_names), names = rawNames.split("、").map((item) => item.trim()).filter(Boolean);
  const subject = names.length ? (names.length <= 3 ? names.join("、") : `${names.slice(0, 2).join("、")}等${names.length}人`) : text(row.className ?? row.class_name) || text(row.courseName ?? row.course_name) || "学生待关联";
  const location = text(row.location) || (text(row.mode) === "online" ? "线上" : "地点待补");
  const start = clock(row.startTime ?? row.start_time) || "待定", end = clock(row.endTime ?? row.end_time) || "待定";
  return { studentNames: names, displayTitle: `${subject}——${location}——${start}-${end}` };
}
