export const grades = ["七年级", "八年级", "九年级", "高一", "高二", "高三"];
export const regularExams = ["第一次月考", "期中考试", "第二次月考", "期末考试"];
export const graduationExams: Record<string, string[]> = { 九年级: ["一模", "二模", "三模", "中考"], 高三: ["一模", "二模", "三模", "高考"] };
export const stageForGrade = (grade: string) => grade.startsWith("高") ? "高中" : "初中";
export const promotionForGrade = (grade: string) => ({ 七年级: "八年级", 八年级: "九年级", 九年级: "毕业", 高一: "高二", 高二: "高三", 高三: "毕业" } as Record<string, string>)[grade] || "";
export function academicYearDates(name: string) {
  const match = name.match(/^(20\d{2})-(20\d{2})$/), start = Number(match?.[1]), end = Number(match?.[2]);
  if (!match || end !== start + 1) return null;
  return { startDate: `${start}-09-01`, endDate: `${end}-08-31` };
}
export const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const standardDeviation = (values: number[]) => { const mean = average(values); return mean == null || values.length < 3 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length); };
