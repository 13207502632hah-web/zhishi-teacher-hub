export type ScheduleRow = Record<string, unknown>;
export type ScheduleMapping = Record<string, string>;

const aliases: Record<string, string[]> = {
  date: ["日期", "上课日期", "具体日期", "date"], startTime: ["开始时间", "上课时间", "开始", "start"], endTime: ["结束时间", "下课时间", "结束", "end"],
  duration: ["时长", "课时", "小时"], studentNames: ["学生", "学生姓名", "姓名", "学员"], className: ["班级", "班级名称"], courseName: ["课程", "课程名称", "科目"],
  location: ["地点", "上课地点", "校区"], institution: ["机构", "所属机构"], fee: ["课时费", "单价", "费用"], baseFee: ["底薪", "基础课时费"], perStudentFee: ["学生提成", "人头费", "每生提成"], settlementCycle: ["结算方式", "结算周期"], notes: ["备注", "说明"],
};

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, "");
export function detectScheduleMapping(headers: string[]): ScheduleMapping {
  const result: ScheduleMapping = {};
  for (const [field, names] of Object.entries(aliases)) {
    const found = headers.find((header) => names.some((name) => clean(header).toLowerCase() === clean(name).toLowerCase()));
    if (found) result[field] = found;
  }
  return result;
}

export function normalizeScheduleRow(row: ScheduleRow, mapping: ScheduleMapping) {
  const get = (field: string) => row[mapping[field]];
  const date = normalizeDate(get("date")), startTime = normalizeTime(get("startTime"));
  let endTime = normalizeTime(get("endTime"));
  const duration = Number(get("duration") || 0);
  if (!endTime && startTime && duration) endTime = addHours(startTime, duration);
  return {
    date, startTime, endTime, studentNames: String(get("studentNames") || "").split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean),
    className: String(get("className") || "").trim(), courseName: String(get("courseName") || "政治").trim(), location: String(get("location") || "").trim(), institution: String(get("institution") || "").trim(),
    fee: numberOrZero(get("fee")), baseFee: numberOrZero(get("baseFee")), perStudentFee: numberOrZero(get("perStudentFee")), settlementCycle: String(get("settlementCycle") || "").trim(), notes: String(get("notes") || "").trim(),
  };
}

export function validateNormalizedSchedule(row: ReturnType<typeof normalizeScheduleRow>) {
  const issues: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) issues.push("日期无法识别");
  if (!row.startTime || !row.endTime) issues.push("上课时间不完整");
  if (row.startTime && row.endTime && row.startTime >= row.endTime) issues.push("结束时间必须晚于开始时间");
  if (!row.studentNames.length && !row.className) issues.push("缺少学生或班级");
  return issues;
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000) return new Date(Date.UTC(1899, 11, 30 + value)).toISOString().slice(0, 10);
  const text = String(value || "").trim().replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/); return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
}
function normalizeTime(value: unknown) { if (value instanceof Date) return value.toISOString().slice(11, 16); if (typeof value === "number" && value >= 0 && value < 1) { const mins = Math.round(value * 1440); return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; } const m = String(value || "").match(/(\d{1,2})[:：时](\d{0,2})/); return m ? `${m[1].padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}` : ""; }
function addHours(time: string, hours: number) { const [h, m] = time.split(":").map(Number), total = h * 60 + m + Math.round(hours * 60); return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function numberOrZero(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }

