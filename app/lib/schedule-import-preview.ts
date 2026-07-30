import type { normalizeScheduleRow } from "./schedule-import";

export type NormalizedScheduleRow = ReturnType<typeof normalizeScheduleRow>;
export type ScheduleImportAction = "create" | "update" | "skip" | "blocked";

export type ScheduleImportRowPreview = {
  action: ScheduleImportAction;
  classToCreate: string | null;
  existingLessonId: number | null;
  issues: string[];
  studentsToCreate: string[];
};

type PreviousSchedule = {
  lessonId: number;
  value: NormalizedScheduleRow;
};

export const scheduleIdentity = (value: NormalizedScheduleRow) =>
  [
    value.date,
    value.className || "",
    [...(value.studentNames || [])].sort().join("、"),
    value.courseName || "",
  ].join("|");

export async function loadPreviousScheduleIdentities(
  db: D1Database,
  excludeImportId?: number,
) {
  const query = excludeImportId
    ? "SELECT sir.lesson_id,sir.normalized_data FROM schedule_import_rows sir JOIN schedule_imports si ON si.id=sir.import_id WHERE si.status='confirmed' AND si.id!=? AND sir.lesson_id IS NOT NULL ORDER BY sir.id DESC"
    : "SELECT sir.lesson_id,sir.normalized_data FROM schedule_import_rows sir JOIN schedule_imports si ON si.id=sir.import_id WHERE si.status='confirmed' AND sir.lesson_id IS NOT NULL ORDER BY sir.id DESC";
  const statement = excludeImportId
    ? db.prepare(query).bind(excludeImportId)
    : db.prepare(query);
  const rows = (await statement.all()).results as Array<{
    lesson_id: number;
    normalized_data: string;
  }>;
  const previousByIdentity = new Map<string, PreviousSchedule>();

  for (const row of rows) {
    const value = JSON.parse(String(row.normalized_data || "{}")) as NormalizedScheduleRow;
    const key = scheduleIdentity(value);
    if (!previousByIdentity.has(key)) {
      previousByIdentity.set(key, { lessonId: Number(row.lesson_id), value });
    }
  }
  return previousByIdentity;
}

export async function inspectScheduleImportRow(
  db: D1Database,
  value: NormalizedScheduleRow,
  validationIssues: string[],
  previousByIdentity: Map<string, PreviousSchedule>,
): Promise<ScheduleImportRowPreview> {
  if (validationIssues.length) {
    return blocked(validationIssues);
  }

  const previous = previousByIdentity.get(scheduleIdentity(value));
  if (previous?.lessonId) {
    const old = await db
      .prepare(
        "SELECT l.id,l.status,l.start_time AS startTime,l.end_time AS endTime,l.location,lf.status AS financeStatus FROM lessons l LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id WHERE l.id=?",
      )
      .bind(previous.lessonId)
      .first<Record<string, unknown>>();
    const changed = old && (
      String(old.startTime || "") !== String(value.startTime || "") ||
      String(old.endTime || "") !== String(value.endTime || "") ||
      String(old.location || "") !== String(value.location || "")
    );

    if (old && !changed) {
      return ready("skip", Number(old.id), ["与上次已确认课表一致"]);
    }
    if (
      old &&
      (
        String(old.status) === "completed" ||
        !["", "review", "pending"].includes(String(old.financeStatus || ""))
      )
    ) {
      return blocked(
        ["原课时已完成或已结算，请在课时详情中人工确认调整"],
        Number(old.id),
      );
    }
    if (old && changed) {
      const conflict = await overlappingLesson(db, value, Number(old.id));
      if (conflict) {
        return blocked(
          [`调整后的时段与“${String(conflict.courseName || "其他课程")}”冲突`],
          Number(old.id),
        );
      }
      return ready("update", Number(old.id), ["将调整上次导入的未结算课时"]);
    }
  }

  const same = await db
    .prepare(
      "SELECT id FROM lessons WHERE date=? AND start_time=? AND course_name=? AND status!='cancelled' LIMIT 1",
    )
    .bind(value.date, value.startTime, value.courseName)
    .first<{ id: number }>();
  if (same) {
    return ready("skip", Number(same.id), ["已有同日期、同时间、同课程课时"]);
  }

  const conflict = await overlappingLesson(db, value);
  if (conflict) {
    return blocked([
      `该时段与“${String(conflict.courseName || "其他课程")}”冲突`,
    ], Number(conflict.id));
  }

  const studentsToCreate: string[] = [];
  for (const name of value.studentNames || []) {
    const matches = (await db
      .prepare("SELECT id FROM students WHERE name=? AND status='active'")
      .bind(name)
      .all()).results;
    if (matches.length > 1) {
      return blocked([`学生“${name}”存在同名档案，请人工选择`]);
    }
    if (matches.length === 0) studentsToCreate.push(name);
  }

  const className = value.className ||
    (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
  let classToCreate: string | null = null;
  if (className) {
    const existingClass = await db
      .prepare("SELECT id FROM classes WHERE name=? AND status='active' LIMIT 1")
      .bind(className)
      .first<{ id: number }>();
    if (!existingClass) classToCreate = className;
  }

  return {
    action: "create",
    classToCreate,
    existingLessonId: null,
    issues: [],
    studentsToCreate,
  };
}

async function overlappingLesson(
  db: D1Database,
  value: NormalizedScheduleRow,
  excludedLessonId?: number,
) {
  const query = excludedLessonId
    ? "SELECT id,course_name AS courseName FROM lessons WHERE id!=? AND date=? AND status!='cancelled' AND start_time<? AND end_time>? LIMIT 1"
    : "SELECT id,course_name AS courseName FROM lessons WHERE date=? AND status!='cancelled' AND start_time<? AND end_time>? LIMIT 1";
  return excludedLessonId
    ? db.prepare(query)
      .bind(excludedLessonId, value.date, value.endTime, value.startTime)
      .first<Record<string, unknown>>()
    : db.prepare(query)
      .bind(value.date, value.endTime, value.startTime)
      .first<Record<string, unknown>>();
}

const ready = (
  action: Extract<ScheduleImportAction, "update" | "skip">,
  existingLessonId: number,
  issues: string[],
): ScheduleImportRowPreview => ({
  action,
  classToCreate: null,
  existingLessonId,
  issues,
  studentsToCreate: [],
});

const blocked = (
  issues: string[],
  existingLessonId: number | null = null,
): ScheduleImportRowPreview => ({
  action: "blocked",
  classToCreate: null,
  existingLessonId,
  issues,
  studentsToCreate: [],
});
