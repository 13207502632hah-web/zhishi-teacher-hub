import type { NormalizedScheduleRow } from "./schedule-import-preview";

export type ScheduleRowState =
  | "pending"
  | "processing"
  | "blocked"
  | "failed"
  | "needs_reconcile"
  | "done";

export async function claimScheduleImportRow(
  db: D1Database,
  rowId: number,
) {
  const result = await db
    .prepare(
      "UPDATE schedule_import_rows SET processing_state='processing',attempts=COALESCE(attempts,0)+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (processing_state IS NULL OR processing_state='failed' OR processing_state='blocked' OR processing_state='needs_reconcile' OR (processing_state='processing' AND datetime(updated_at)<datetime('now','-5 minutes')))",
    )
    .bind(rowId)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

export async function markScheduleImportRow(
  db: D1Database,
  rowId: number,
  patch: {
    action: string;
    state: ScheduleRowState;
    lessonId?: number | null;
    issue?: string | null;
    lastError?: string | null;
  },
) {
  await db
    .prepare(
      "UPDATE schedule_import_rows SET action=?,issue=?,lesson_id=COALESCE(?,lesson_id),processing_state=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(
      patch.action,
      patch.issue ?? null,
      patch.lessonId ?? null,
      patch.state,
      patch.lastError ?? null,
      rowId,
    )
    .run();
}

export async function loadLessonState(
  db: D1Database,
  lessonId: number,
) {
  return db
    .prepare(
      "SELECT l.id,l.class_id AS classId,l.date,l.start_time AS startTime,l.end_time AS endTime,l.mode,l.location,l.course_name AS courseName,l.status,l.fee,lf.status AS financeStatus FROM lessons l LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id WHERE l.id=?",
    )
    .bind(lessonId)
    .first<Record<string, unknown>>();
}

export async function reconcileLessonFinance(
  db: D1Database,
  lessonId: number,
  value: NormalizedScheduleRow,
) {
  if (!value.institution && !value.baseFee && !value.perStudentFee && !value.fee) {
    return { inserted: false, reason: "no-finance-fields" as const };
  }
  let institutionId: number | null = null;
  if (value.institution) {
    const institution = await db
      .prepare("SELECT id FROM institutions WHERE name=? LIMIT 1")
      .bind(value.institution)
      .first<{ id: number }>();
    institutionId = institution?.id ?? null;
    if (!institutionId) {
      const created = await db
        .prepare("INSERT INTO institutions(name,settlement_cycle) VALUES(?,?) RETURNING id")
        .bind(value.institution, settlementCycle(value.settlementCycle))
        .first<{ id: number }>();
      institutionId = created?.id ?? null;
    }
  }
  const expectedAmount = value.fee ||
    value.baseFee + value.perStudentFee * (value.studentNames?.length || 0);
  const result = await db
    .prepare(
      "INSERT OR IGNORE INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,expected_amount,status) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      lessonId,
      institutionId ? "institution" : "parent",
      institutionId,
      value.baseFee || 0,
      expectedAmount,
      "review",
    )
    .run();
  return { inserted: Number(result.meta?.changes || 0) > 0, reason: "reconciled" as const };
}

const settlementCycle = (value?: string) =>
  value?.includes("次") ? "per_lesson" : value?.includes("周") ? "weekly" : "monthly";
