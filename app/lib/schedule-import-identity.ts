export type ScheduleBusinessValue = {
  date: string;
  startTime: string;
  endTime: string;
  className?: string;
  studentNames?: string[];
  courseName?: string;
  location?: string;
  fee?: number;
  baseFee?: number;
  perStudentFee?: number;
  institution?: string;
  settlementCycle?: string;
};

const normalizedName = (value?: string | null) => String(value ?? "").trim();

export function scheduleScopeKey(value: ScheduleBusinessValue) {
  const className = normalizedName(value.className);
  if (className) return `class:${className}`;
  const students = (value.studentNames || [])
    .map(normalizedName)
    .filter(Boolean)
    .sort();
  return students.length ? `students:${students.join("、")}` : "";
}

/**
 * 课时的业务身份包含日期、班级或学生范围、课程名称。
 * 时间只负责冲突判断，不能作为“同一节课”的判重依据。
 */
export function lessonBusinessIdentity(value: ScheduleBusinessValue) {
  return [
    normalizedName(value.date),
    scheduleScopeKey(value),
    normalizedName(value.courseName),
  ].join("|");
}

export async function findClassId(
  db: D1Database,
  className: string,
  ownerId?: number,
) {
  const name = normalizedName(className);
  if (!name) return null;
  const scoped = typeof ownerId === "number" && Number.isFinite(ownerId);
  const query = scoped
    ? "SELECT id FROM classes WHERE name=? AND status='active' AND (owner_id=? OR owner_id IS NULL) LIMIT 1"
    : "SELECT id FROM classes WHERE name=? AND status='active' LIMIT 1";
  const statement = scoped
    ? db.prepare(query).bind(name, ownerId)
    : db.prepare(query).bind(name);
  const row = await statement.first<{ id: number }>();
  return row ? Number(row.id) : null;
}

export async function findStudentRecords(
  db: D1Database,
  name: string,
) {
  const rows = (await db
    .prepare("SELECT id FROM students WHERE name=? AND status='active'")
    .bind(name)
    .all()).results as Array<{ id: number }>;
  return rows.map((row) => Number(row.id));
}

const lessonSelect =
  "SELECT l.id,l.status,l.start_time AS startTime,l.end_time AS endTime,l.location,l.class_id AS classId,lf.status AS financeStatus FROM lessons l LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id";

export async function findLessonByIdentity(
  db: D1Database,
  value: ScheduleBusinessValue,
  ownerId?: number,
  excludedLessonIds?: Set<number>,
) {
  const className = normalizedName(value.className);
  if (className) {
    const classId = await findClassId(db, className, ownerId);
    if (!classId) return null;
    const exclusion = exclusionSql(excludedLessonIds);
    const excluded = exclusion.placeholders
      ? ` AND l.id NOT IN (${exclusion.placeholders})`
      : "";
    return db.prepare(
      `${lessonSelect} WHERE l.class_id=? AND l.date=? AND l.course_name=? AND l.status!='cancelled'${excluded} ORDER BY l.id DESC LIMIT 1`,
    )
      .bind(classId, value.date, value.courseName, ...exclusion.values)
      .first<Record<string, unknown>>();
  }
  const names = (value.studentNames || []).map(normalizedName).filter(Boolean);
  if (!names.length) return null;
  const resolved: number[] = [];
  for (const name of names) {
    const studentIds = await findStudentRecords(db, name);
    if (studentIds.length !== 1) return null;
    resolved.push(studentIds[0]);
  }
  const candidates = (await db.prepare(
    `${lessonSelect} JOIN enrollments e ON e.class_id=l.class_id WHERE e.student_id=? AND l.date=? AND l.course_name=? AND l.status!='cancelled' ORDER BY l.id DESC`,
  )
    .bind(resolved[0], value.date, value.courseName)
    .all()).results as Array<Record<string, unknown>>;
  for (const candidate of candidates) {
    if (excludedLessonIds?.has(Number(candidate.id))) continue;
    if (await studentsMatchClass(db, candidate.classId, resolved)) {
      return candidate;
    }
  }
  return null;
}

const exclusionSql = (excludedLessonIds?: Set<number>) => {
  if (!excludedLessonIds?.size) return { placeholders: "", values: [] as number[] };
  return {
    placeholders: Array.from(excludedLessonIds, () => "?").join(","),
    values: Array.from(excludedLessonIds),
  };
};

async function studentsMatchClass(
  db: D1Database,
  classId: unknown,
  studentIds: number[],
) {
  const expected = new Set(studentIds.map(Number));
  const enrolled = (await db
    .prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'")
    .bind(classId)
    .all()).results as Array<{ studentId: number }>;
  const actual = new Set(enrolled.map((row) => Number(row.studentId)));
  if (actual.size !== expected.size) return false;
  for (const studentId of expected) {
    if (!actual.has(studentId)) return false;
  }
  return true;
}

export type LineageLesson = {
  importRowId: number;
  lessonId: number;
  action: string | null;
  normalizedData: string | null;
};

export async function findLineageLessons(
  db: D1Database,
  sourceLineage: string,
  sourceRowId: string,
) {
  if (!sourceLineage || !sourceRowId) return [];
  const rows = (await db
    .prepare(
      "SELECT id AS importRowId,lesson_id AS lessonId,action,normalized_data AS normalizedData FROM schedule_import_rows WHERE source_lineage=? AND source_row_id=? AND lesson_id IS NOT NULL AND action IN ('created','updated','skipped') ORDER BY id DESC",
    )
    .bind(sourceLineage, sourceRowId)
    .all()).results as Array<LineageLesson>;
  return rows;
}

export function lessonUnlockable(old: {
  status?: string;
  financeStatus?: string | null;
}) {
  if (String(old.status || "") === "completed") return false;
  return ["", "review", "pending"].includes(String(old.financeStatus || ""));
}

export function scheduleFieldsChanged(
  old: Record<string, unknown>,
  value: ScheduleBusinessValue,
) {
  return (
    String(old.startTime || "") !== String(value.startTime || "") ||
    String(old.endTime || "") !== String(value.endTime || "") ||
    String(old.location || "") !== String(value.location || "")
  );
}
