type CalendarLesson = { id: number; date: string; startTime?: string | null; endTime?: string | null; courseName: string; topic?: string | null; location?: string | null; className?: string | null; courseType?: string | null; studentNames?: string | null; updatedAt?: string | null };
const esc = (value: unknown) => String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = (date: string, time?: string | null) => `${date.replace(/-/g, "")}T${String(time || "00:00").replace(":", "")}00`;
export function createCalendar(lessons: CalendarLesson[], reminderMinutes = 30) {
  const events = lessons.filter((item) => item.date && item.startTime && item.endTime).map((item) => { const names = String(item.studentNames || "").split("、").map((name) => name.trim()).filter(Boolean), subject = names.length ? (names.length <= 3 ? names.join("、") : `${names.slice(0, 2).join("、")}等${names.length}人`) : String(item.courseType || item.className || item.courseName || "课程"), course = String(item.topic || item.courseName || "课程"); return [
    "BEGIN:VEVENT", `UID:lesson-${item.id}@zhishi-teacher-hub`, `DTSTAMP:${stamp((item.updatedAt || new Date().toISOString()).slice(0, 10), (item.updatedAt || "").slice(11, 16))}Z`,
    `DTSTART;TZID=Asia/Shanghai:${stamp(item.date, item.startTime)}`, `DTEND;TZID=Asia/Shanghai:${stamp(item.date, item.endTime)}`, `SUMMARY:${esc(subject)} · ${esc(course)}`, `LOCATION:${esc(item.location)}`, `DESCRIPTION:${esc(`对象：${subject}\n课程：${course}\n时间：${item.startTime}–${item.endTime}\n地点：${item.location || "待补"}`)}`,
    "BEGIN:VALARM", `TRIGGER:-PT${Math.max(0, reminderMinutes)}M`, "ACTION:DISPLAY", "DESCRIPTION:即将上课", "END:VALARM", "END:VEVENT",
  ].join("\r\n"); });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//知师研室//课程订阅//CN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", ...events, "END:VCALENDAR", ""].join("\r\n");
}
