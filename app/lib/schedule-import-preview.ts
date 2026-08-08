import type { normalizeScheduleRow } from "./schedule-import";
import {
  findClassId,
  findLessonByIdentity,
  findLineageLessons,
  findStudentRecords,
  lessonBusinessIdentity,
  lessonUnlockable,
  scheduleFieldsChanged,
  type ScheduleBusinessValue,
  type ScheduleIdentityCache,
} from "./schedule-import-identity";

export type NormalizedScheduleRow = ReturnType<typeof normalizeScheduleRow>;
export type ScheduleImportAction = "create" | "update" | "skip" | "blocked";

export type ScheduleImportRowPreview = {
  action: ScheduleImportAction;
  classToCreate: string | null;
  existingLessonId: number | null;
  issues: string[];
  studentsToCreate: string[];
};

export type SchedulePreviewContext = {
  ownerId?: number;
  sourceLineage?: string;
  sourceRowId?: string;
  currentImportLessonIds?: Set<number>;
  cache?: ScheduleIdentityCache;
};

type PreviousSchedule = {
  lessonId: number;
  value: NormalizedScheduleRow;
};

export const scheduleIdentity = (value: NormalizedScheduleRow) =>
  lessonBusinessIdentity(value);

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
    const value = parseStoredValue(row.normalized_data);
    if (!value) continue;
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
  context: SchedulePreviewContext = {},
): Promise<ScheduleImportRowPreview> {
  if (validationIssues.length) {
    return blocked(validationIssues);
  }

  const lineageResult = await inspectLineageRevision(db, value, context);
  if (lineageResult) return lineageResult;

  const previous = previousByIdentity.get(scheduleIdentity(value));
  if (previous?.lessonId) {
    const old = await loadLesson(db, previous.lessonId);
    if (old) {
      const decision = await decideAgainstOldLesson(db, value, old, context);
      if (decision) return decision;
    }
  }

  const exact = await findLessonByIdentity(
    db,
    value,
    context.ownerId,
    context.currentImportLessonIds,
    context.cache,
  );
  if (exact) {
    const decision = await decideAgainstOldLesson(db, value, exact, context);
    if (decision) return decision;
  }

  const conflict = await overlappingLesson(db, value, context);
  if (conflict) {
    return blocked([
      `该时段与“${String(conflict.courseName || "其他课程")}”冲突`,
    ], Number(conflict.id));
  }

  const studentsToCreate: string[] = [];
  for (const name of value.studentNames || []) {
    const matches = await findStudentRecords(db, name, context.cache);
    if (matches.length > 1) {
      return blocked([`学生“${name}”存在同名档案，请人工选择`]);
    }
    if (matches.length === 0) studentsToCreate.push(name);
  }

  const className = value.className ||
    (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
  let classToCreate: string | null = null;
  if (className) {
    const existingClass = await findClassId(db, className, context.ownerId, context.cache);
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

async function inspectLineageRevision(
  db: D1Database,
  value: NormalizedScheduleRow,
  context: SchedulePreviewContext,
) {
  const lineageLessons = await findLineageLessons(
    db,
    context.sourceLineage || "",
    context.sourceRowId || "",
  );
  if (!lineageLessons.length) return null;
  const distinct = new Set(lineageLessons.map((item) => Number(item.lessonId)));
  const latest = lineageLessons[0];
  const old = await loadLesson(db, Number(latest.lessonId));
  if (!old) {
    return blocked(["原课时已不存在，请重新上传课表"], Number(latest.lessonId));
  }
  if (distinct.size > 1) {
    return blocked(
      ["跨日期修订无法唯一确认原课时，请在课时详情中人工确认"],
      Number(latest.lessonId),
    );
  }
  const oldValue = parseStoredValue(latest.normalizedData);
  const identityChanged = oldValue
    ? lessonBusinessIdentity(oldValue) !== lessonBusinessIdentity(value)
    : false;
  const changed = scheduleFieldsChanged(old, value);
  if (!identityChanged && !changed) {
    return ready("skip", Number(old.id), ["与上次已确认课表一致"]);
  }
  if (!lessonUnlockable(old)) {
    return blocked(
      ["原课时已完成或已结算，请在课时详情中人工确认调整"],
      Number(old.id),
    );
  }
  const conflict = await overlappingLesson(db, value, context, Number(old.id));
  if (conflict) {
    return blocked(
      [`调整后的时段与“${String(conflict.courseName || "其他课程")}”冲突`],
      Number(old.id),
    );
  }
  return ready(
    "update",
    Number(old.id),
    [
      identityChanged
        ? "将调整上次导入的课时（含日期或范围修订）"
        : "将调整上次导入的未结算课时",
    ],
  );
}

async function decideAgainstOldLesson(
  db: D1Database,
  value: NormalizedScheduleRow,
  old: Record<string, unknown>,
  context: SchedulePreviewContext,
) {
  const changed = scheduleFieldsChanged(old, value);
  if (!changed) {
    return ready("skip", Number(old.id), ["与上次已确认课表一致"]);
  }
  if (!lessonUnlockable(old)) {
    return blocked(
      ["原课时已完成或已结算，请在课时详情中人工确认调整"],
      Number(old.id),
    );
  }
  const conflict = await overlappingLesson(db, value, context, Number(old.id));
  if (conflict) {
    return blocked(
      [`调整后的时段与“${String(conflict.courseName || "其他课程")}”冲突`],
      Number(old.id),
    );
  }
  return ready("update", Number(old.id), ["将调整上次导入的未结算课时"]);
}

async function loadLesson(db: D1Database, lessonId: number) {
  return db
    .prepare(
      "SELECT l.id,l.status,l.start_time AS startTime,l.end_time AS endTime,l.location,l.class_id AS classId,lf.status AS financeStatus FROM lessons l LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id WHERE l.id=?",
    )
    .bind(lessonId)
    .first<Record<string, unknown>>();
}

async function overlappingLesson(
  db: D1Database,
  value: ScheduleBusinessValue,
  context: SchedulePreviewContext = {},
  excludedLessonId?: number,
) {
  const className = String(value.className || "").trim();
  if (className) {
    const classId = await findClassId(db, className, context.ownerId, context.cache);
    if (!classId) return null;
    const query = excludedLessonId
      ? "SELECT l.id,l.course_name AS courseName FROM lessons l WHERE l.id!=? AND l.class_id=? AND l.date=? AND l.status!='cancelled' AND l.start_time<? AND l.end_time>? LIMIT 1"
      : "SELECT l.id,l.course_name AS courseName FROM lessons l WHERE l.class_id=? AND l.date=? AND l.status!='cancelled' AND l.start_time<? AND l.end_time>? LIMIT 1";
    return excludedLessonId
      ? db.prepare(query)
        .bind(excludedLessonId, classId, value.date, value.endTime, value.startTime)
        .first<Record<string, unknown>>()
      : db.prepare(query)
        .bind(classId, value.date, value.endTime, value.startTime)
        .first<Record<string, unknown>>();
  }
  for (const name of value.studentNames || []) {
    const studentIds = await findStudentRecords(db, name, context.cache);
    if (studentIds.length !== 1) continue;
    const query = excludedLessonId
      ? "SELECT l.id,l.course_name AS courseName FROM lessons l JOIN enrollments e ON e.class_id=l.class_id WHERE l.id!=? AND e.student_id=? AND l.date=? AND l.status!='cancelled' AND l.start_time<? AND l.end_time>? LIMIT 1"
      : "SELECT l.id,l.course_name AS courseName FROM lessons l JOIN enrollments e ON e.class_id=l.class_id WHERE e.student_id=? AND l.date=? AND l.status!='cancelled' AND l.start_time<? AND l.end_time>? LIMIT 1";
    const conflict = excludedLessonId
      ? await db.prepare(query)
        .bind(excludedLessonId, studentIds[0], value.date, value.endTime, value.startTime)
        .first<Record<string, unknown>>()
      : await db.prepare(query)
        .bind(studentIds[0], value.date, value.endTime, value.startTime)
        .first<Record<string, unknown>>();
    if (conflict) return conflict;
  }
  return null;
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

const parseStoredValue = (value: string | null) => {
  try {
    const parsed = JSON.parse(String(value || "{}")) as NormalizedScheduleRow;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
