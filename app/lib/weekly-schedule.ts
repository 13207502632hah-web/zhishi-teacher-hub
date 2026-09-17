/** Date-only arithmetic: no browser timezone or daylight-saving conversion. */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= "1900-01-01" && value <= "2200-12-31"
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export const calendarDayDifference = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
export const shiftCalendarDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function calendarWeekDates(anchor: string) {
  if (!isCalendarDate(anchor)) return [];
  const offset = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDate(anchor, index - offset));
}
export function weeklyDates(start: string, end: string, weekday: number) {
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) throw new Error("请填写有效的起止日期，结束日期不能早于开始日期");
  if (calendarDayDifference(start, end) > 730) throw new Error("单份循环课表最多安排两年，请分学年建立");
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("请选择每周上课日");
  const first = shiftCalendarDate(start, (weekday - new Date(`${start}T00:00:00Z`).getUTCDay() + 7) % 7);
  const dates: string[] = [];
  for (let date = first; date <= end; date = shiftCalendarDate(date, 7)) dates.push(date);
  if (!dates.length) throw new Error("起止日期内没有所选的星期，请调整日期");
  return dates;
}
export const validClockTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
