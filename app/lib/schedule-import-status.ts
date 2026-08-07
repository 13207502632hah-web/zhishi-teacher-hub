export type ScheduleImportResultRow = {
  action: string;
  lessonId: number | null;
};

export function scheduleImportFinalStatus(rows: ScheduleImportResultRow[]) {
  const final = rows.filter((row) => ["created", "updated", "skipped"].includes(row.action));
  const remaining = rows.filter((row) => row.action === "pending" || row.action === "blocked");
  return {
    status: remaining.length
      ? final.length
        ? "partial"
        : "failed"
      : "confirmed",
    remaining: remaining.length,
  };
}
