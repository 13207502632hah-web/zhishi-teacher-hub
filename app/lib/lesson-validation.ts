export const lessonStatuses = ["draft", "scheduled", "completed", "cancelled", "rescheduled", "makeup"] as const;

export function validateLessonTime(input: Record<string, unknown>) {
  const start = String(input.startTime || ""), end = String(input.endTime || ""), status = String(input.status || "draft");
  if (!lessonStatuses.includes(status as typeof lessonStatuses[number])) return "课时状态无效";
  if ((start && !end) || (!start && end)) return "开始和结束时间需要同时填写";
  if (start && end && start >= end) return "结束时间必须晚于开始时间";
  if (status === "cancelled" && !String(input.cancellationReason || "").trim()) return "取消课时请填写原因";
  return null;
}

export function usesTeachingSlot(status: unknown) {
  return !["cancelled"].includes(String(status || "draft"));
}
