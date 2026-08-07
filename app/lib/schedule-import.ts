export type ScheduleRow = Record<string, unknown>;
export type ScheduleMapping = Record<string, string>;
export type UnknownScheduleColumn = { name: string; suggestions: string[] };
export type ScheduleMappingDetail = {
  mapping: ScheduleMapping;
  unknownColumns: UnknownScheduleColumn[];
};

const aliases: Record<string, string[]> = {
  date: ["日期", "上课日期", "具体日期", "date"], startTime: ["时间", "开始时间", "上课时间", "开始", "start"], endTime: ["结束时间", "下课时间", "结束", "end"],
  duration: ["时长", "课时", "小时"], studentNames: ["学生", "学生姓名", "姓名", "学员"], className: ["班级", "班级名称"], studentClass: ["学生/班级", "学生/班"], courseName: ["课程", "课程名称", "科目", "学科"],
  location: ["地点", "上课地点", "校区"], institution: ["机构", "所属机构"], fee: ["课时费", "单价", "费用"], baseFee: ["底薪", "基础课时费"], perStudentFee: ["学生提成", "人头费", "每生提成"], settlementCycle: ["结算方式", "结算周期"], notes: ["备注", "说明"],
};

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[\s，。；、：:：,;!！?？·.．\-—–_~*#【】[\]<>《》"'“”‘’`]/g, "")
    .replace(/必填|选填/g, "");

const normalizedAliasMap = Object.fromEntries(
  Object.entries(aliases).map(([field, names]) => [field, names.map(normalizeHeader)]),
);

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function headerScore(header: string, alias: string) {
  if (!header || !alias) return 0;
  if (header === alias) return 100 + alias.length;
  if (header.includes(alias) && alias.length >= 2) return 80 + alias.length;
  if (alias.includes(header) && header.length >= 2) return 60 + header.length;
  const distance = editDistance(header, alias);
  const threshold = Math.max(header.length, alias.length) >= 6 ? 2 : 1;
  return distance > 0 && distance <= threshold ? 50 - distance : 0;
}

export function detectScheduleMapping(headers: string[]): ScheduleMapping {
  return detectScheduleMappingDetail(headers).mapping;
}

export function detectScheduleMappingDetail(headers: string[]): ScheduleMappingDetail {
  const normalizedHeaders = headers.map((header, index) => ({
    index,
    name: String(header ?? ""),
    normalized: normalizeHeader(header),
  }));
  const used = new Set<number>();
  const mapping: ScheduleMapping = {};

  for (const [field, names] of Object.entries(normalizedAliasMap)) {
    const match = normalizedHeaders.find((entry) => !used.has(entry.index) && names.includes(entry.normalized));
    if (match) {
      mapping[field] = match.name;
      used.add(match.index);
    }
  }

  for (const [field, names] of Object.entries(normalizedAliasMap)) {
    if (mapping[field]) continue;
    let best: { index: number; score: number } | null = null;
    for (const entry of normalizedHeaders) {
      if (used.has(entry.index)) continue;
      const score = Math.max(...names.map((alias) => headerScore(entry.normalized, alias)));
      if (score > 0 && (!best || score > best.score)) best = { index: entry.index, score };
    }
    if (best) {
      mapping[field] = normalizedHeaders[best.index].name;
      used.add(best.index);
    }
  }

  const unknownColumns = normalizedHeaders
    .filter((entry) => !used.has(entry.index) && entry.normalized)
    .map((entry) => ({ name: entry.name, suggestions: suggestAliases(entry.normalized) }));
  return { mapping, unknownColumns };
}

function suggestAliases(normalizedHeader: string) {
  const scored: Array<{ name: string; score: number }> = [];
  for (const names of Object.values(aliases)) {
    for (const name of names) {
      const score = headerScore(normalizedHeader, normalizeHeader(name));
      if (score > 0) scored.push({ name, score });
    }
  }
  const seen = new Set<string>();
  return scored
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      const key = normalizeHeader(candidate.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((candidate) => candidate.name);
}

export function normalizeScheduleRow(row: ScheduleRow, mapping: ScheduleMapping, sourceName = "") {
  const get = (field: string) => row[mapping[field]];
  const date = normalizeDate(get("date"), sourceName), timeRange = normalizeTimeRange(get("startTime")), startTime = timeRange.start;
  let endTime = timeRange.end || normalizeTime(get("endTime"));
  const duration = Number(get("duration") || 0);
  if (!endTime && startTime && duration) endTime = addHours(startTime, duration);
  const studentClass = String(get("studentClass") || "").trim();
  let studentNames = String(get("studentNames") || "").split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean);
  let className = String(get("className") || "").trim();
  if (studentClass) {
    if (/班/.test(studentClass)) className = studentClass;
    else studentNames = studentClass.split(/[、,，;；/]/).map((item) => item.trim()).filter(Boolean);
  }
  return {
    date, startTime, endTime, studentNames, className, courseName: String(get("courseName") || inferCourseName([studentClass, className]) || "政治").trim(), location: String(get("location") || "").trim(), institution: String(get("institution") || "").trim(),
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

const calendarDate = (value: unknown) => String(value ?? "").trim().match(/^(?:(20\d{2})[年/])?(\d{1,2})[月/](\d{1,2})日?$/);
const calendarTime = (value: unknown) => String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*[–—~至-]\s*(\d{1,2})(?::(\d{1,2}))?$/);
const weekday = /^(?:周|星期)[一二三四五六日天]$/;
const pad = (value: string | number) => String(value).padStart(2, "0");
const columnName = (index: number) => { let value = index + 1, output = ""; while (value > 0) { value--; output = String.fromCharCode(65 + value % 26) + output; value = Math.floor(value / 26); } return output; };

const coursePrefixes = ["道德与法治", "道法", "数学", "语文", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "科学", "信息技术", "信息", "音乐", "体育", "美术"];

function inferCourseName(labels: Iterable<unknown>) {
  for (const label of labels) {
    const text = String(label ?? "").trim();
    if (!text) continue;
    const prefix = coursePrefixes.find((candidate) => text.startsWith(candidate));
    if (prefix) return prefix;
  }
  return "";
}

export type CalendarScheduleRow = { raw: ScheduleRow; sourceCell: string };

/** 将“日期横排、时间竖排”的周课表转换成每节课一行；只读取明确写入的排课单元格。 */
export function extractCalendarScheduleRows(table: unknown[][], sourceName = "") {
  const output: CalendarScheduleRow[] = [], yearFromName = Number(sourceName.match(/(20\d{2})年?/)?.[1]) || 0;
  let year = yearFromName, previousMonth = 0;
  for (let rowIndex = 0; rowIndex < table.length; rowIndex++) {
    const row = table[rowIndex] || [], dateCells = row.map((value, columnIndex) => ({ columnIndex, match: calendarDate(value) })).filter((item) => item.match);
    if (dateCells.length < 2) continue;
    const dates = new Map<number, string>();
    for (const { columnIndex, match } of dateCells) {
      const explicitYear = Number(match?.[1]) || 0, month = Number(match?.[2]), day = Number(match?.[3]);
      if (explicitYear) year = explicitYear; else if (previousMonth && month < previousMonth && previousMonth - month >= 6) year++;
      previousMonth = month; if (year) dates.set(columnIndex, `${year}-${pad(month)}-${pad(day)}`);
    }
    if (!dates.size) continue;
    const subjectRow = table[rowIndex + 1] || [];
    const labels: string[] = [];
    for (let labelRowIndex = rowIndex + 1; labelRowIndex < table.length; labelRowIndex++) {
      const labelRow = table[labelRowIndex] || [];
      if (labelRowIndex > rowIndex + 1 && labelRow.filter((value) => calendarDate(value)).length >= 2) break;
      for (const value of labelRow) {
        const text = String(value ?? "").trim();
        if (text && !weekday.test(text) && !calendarDate(text) && !calendarTime(text)) labels.push(text);
      }
    }
    const courseName = subjectRow.map((value) => String(value ?? "").trim()).find((value) => value && !weekday.test(value)) || inferCourseName(labels) || "政治";
    for (let timeRowIndex = rowIndex + 1; timeRowIndex < table.length; timeRowIndex++) {
      const timeRow = table[timeRowIndex] || [];
      if (timeRowIndex > rowIndex + 1 && timeRow.filter((value) => calendarDate(value)).length >= 2) break;
      const timeCellIndex = timeRow.findIndex((value) => calendarTime(value));
      const time = timeCellIndex >= 0 ? calendarTime(timeRow[timeCellIndex]) : null;
      if (!time) continue;
      const startTime = `${pad(time[1])}:${pad(time[2] || 0)}`, endTime = `${pad(time[3])}:${pad(time[4] || 0)}`;
      for (const [columnIndex, date] of dates) {
        const label = String(timeRow[columnIndex] ?? "").trim();
        if (!label) continue;
        const className = /班/.test(label) ? label : "", studentNames = className ? "" : label;
        output.push({ sourceCell: `${columnName(columnIndex)}${timeRowIndex + 1}`, raw: { 上课日期: date, 上课时间: startTime, 结束时间: endTime, 学生姓名: studentNames, 班级: className, 课程名称: courseName, 原单元格: `${columnName(columnIndex)}${timeRowIndex + 1}` } });
      }
    }
  }
  return output;
}

export type ScheduleTableSelection = {
  table: unknown[][];
  calendarRows: CalendarScheduleRow[];
  headers: string[];
  mappingDetail: ScheduleMappingDetail;
};

/** 从多个工作表中选出最像课表的一张：横向周历优先，其次首行可映射的明细表。 */
export function selectScheduleTable(tables: unknown[][][], sourceName = ""): ScheduleTableSelection {
  const calendarHeaders = ["上课日期", "上课时间", "结束时间", "学生姓名", "班级", "课程名称"];
  for (const candidate of tables) {
    if (!candidate.some((row) => row.some((cell) => String(cell ?? "").trim()))) continue;
    const calendarRows = extractCalendarScheduleRows(candidate, sourceName);
    if (calendarRows.length) return { table: candidate, calendarRows, headers: calendarHeaders, mappingDetail: detectScheduleMappingDetail(calendarHeaders) };
  }
  for (const candidate of tables) {
    const table = candidate.slice();
    const headers = (table.shift() || []).map(String);
    const mappingDetail = detectScheduleMappingDetail(headers);
    if (mappingDetail.mapping.date && mappingDetail.mapping.startTime) return { table, calendarRows: [], headers, mappingDetail };
  }
  const fallback = tables[0] || [];
  const table = fallback.slice();
  const headers = (table.shift() || []).map(String);
  return { table, calendarRows: [], headers, mappingDetail: detectScheduleMappingDetail(headers) };
}

function normalizeDate(value: unknown, sourceName = "") {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000) return new Date(Date.UTC(1899, 11, 30 + value)).toISOString().slice(0, 10);
  const text = String(value || "").trim().replace(/[年/.]/g, "-").replace(/月/g, "-").replace(/日/g, "");
  const match = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/); if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const short = text.match(/^(\d{1,2})-(\d{1,2})$/); if (!short) return "";
  const year = Number(sourceName.match(/(20\d{2})/)?.[1]) || new Date().getFullYear();
  return `${year}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
}
function normalizeTime(value: unknown) { if (value instanceof Date) return value.toISOString().slice(11, 16); if (typeof value === "number" && value >= 0 && value < 1) { const mins = Math.round(value * 1440); return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; } const m = String(value || "").match(/(\d{1,2})[:：时](\d{0,2})/); return m ? `${m[1].padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}` : ""; }
function normalizeTimeRange(value: unknown) {
  const m = String(value ?? "").trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*[–—~至-]\s*(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return { start: normalizeTime(value), end: "" };
  return { start: `${m[1].padStart(2, "0")}:${(m[2] || "00").padStart(2, "0")}`, end: `${m[3].padStart(2, "0")}:${(m[4] || "00").padStart(2, "0")}` };
}
function addHours(time: string, hours: number) { const [h, m] = time.split(":").map(Number), total = h * 60 + m + Math.round(hours * 60); return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function numberOrZero(value: unknown) { const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
