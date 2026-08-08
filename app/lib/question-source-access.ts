import type { AccessContext } from "./access";

export type QuestionSourceObject = {
  customMetadata?: Record<string, string>;
} | null;

type D1Like = {
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>;
      all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
    };
  };
};

/**
 * 原始 Word 文件的读取权限绑定到上传者或已授权班级。
 * 教师账号兼容第一版工作区数据；助教只能读取本人上传、尚未关联任务、
 * 或已关联到其获授权班级的 sourceKey。
 */
export async function canReadQuestionSourceObject(
  access: AccessContext,
  db: D1Like,
  object: QuestionSourceObject,
  key: string,
): Promise<boolean> {
  if (!object || !key) return false;
  if (access.role === "teacher") return true;
  if (access.role !== "assistant") return false;
  if (String(object.customMetadata?.uploadedBy || "") === String(access.id)) return true;
  const referenced = await db
    .prepare("SELECT id FROM question_sets WHERE source_document=? LIMIT 1")
    .bind(key)
    .first<{ id: number }>();
  if (!referenced) return false;
  return hasQuestionSetClassAccess(db, Number(referenced.id), access.id);
}

/**
 * 助教访问题组原始文件时，要求该题组的题目已经通过课时、试卷、
 * 测验、作业或课时工作流关联到其获授权班级。
 */
export async function hasQuestionSetClassAccess(
  db: D1Like,
  setId: number,
  userId: number,
): Promise<boolean> {
  if (!Number.isFinite(setId) || setId <= 0 || !Number.isFinite(userId) || userId <= 0) return false;
  const classIds = new Set<number>();
  const lessonClasses = await db
    .prepare(`
      SELECT DISTINCT l.class_id AS classId
      FROM questions q
      JOIN lesson_questions lq ON lq.question_id = q.id
      JOIN lessons l ON l.id = lq.lesson_id
      WHERE q.question_set_id = ? AND l.class_id IS NOT NULL
    `)
    .bind(setId)
    .all<{ classId: number }>();
  for (const row of lessonClasses.results) {
    const classId = Number(row.classId);
    if (Number.isFinite(classId) && classId > 0) classIds.add(classId);
  }

  const paperIds = new Set<number>();
  const linkedPapers = await db
    .prepare(`
      SELECT DISTINCT p.id AS paperId
      FROM questions q
      JOIN paper_questions pq ON pq.question_id = q.id
      JOIN papers p ON p.id = pq.paper_id
      WHERE q.question_set_id = ?
    `)
    .bind(setId)
    .all<{ paperId: number }>();
  for (const row of linkedPapers.results) {
    const paperId = Number(row.paperId);
    if (Number.isFinite(paperId) && paperId > 0) paperIds.add(paperId);
  }
  const ownPaper = await db
    .prepare("SELECT paper_id AS paperId FROM question_sets WHERE id=?")
    .bind(setId)
    .first<{ paperId: number | null }>();
  if (ownPaper?.paperId) {
    const paperId = Number(ownPaper.paperId);
    if (Number.isFinite(paperId) && paperId > 0) paperIds.add(paperId);
  }

  if (paperIds.size) {
    const ids = [...paperIds];
    const placeholders = ids.map(() => "?").join(",");
    const [assessmentClasses, assignmentClasses, workflowClasses] = await Promise.all([
      db
        .prepare(`SELECT DISTINCT class_id AS classId FROM assessments WHERE paper_id IN (${placeholders}) AND class_id IS NOT NULL`)
        .bind(...ids)
        .all<{ classId: number }>(),
      db
        .prepare(`
          SELECT DISTINCT COALESCE(a.class_id, l.class_id) AS classId
          FROM assignments a
          LEFT JOIN lessons l ON l.id = a.lesson_id
          WHERE a.paper_id IN (${placeholders}) AND COALESCE(a.class_id, l.class_id) IS NOT NULL
        `)
        .bind(...ids)
        .all<{ classId: number }>(),
      db
        .prepare(`
          SELECT DISTINCT l.class_id AS classId
          FROM lesson_workflow_state w
          JOIN lessons l ON l.id = w.lesson_id
          WHERE w.homework_paper_id IN (${placeholders}) AND l.class_id IS NOT NULL
        `)
        .bind(...ids)
        .all<{ classId: number }>(),
    ]);
    for (const rows of [assessmentClasses.results, assignmentClasses.results, workflowClasses.results]) {
      for (const row of rows) {
        const classId = Number(row.classId);
        if (Number.isFinite(classId) && classId > 0) classIds.add(classId);
      }
    }
  }

  if (!classIds.size) return false;
  const classList = [...classIds];
  const placeholders = classList.map(() => "?").join(",");
  const allowed = await db
    .prepare(`SELECT 1 AS allowed FROM staff_class_access WHERE user_id=? AND class_id IN (${placeholders}) LIMIT 1`)
    .bind(userId, ...classList)
    .first<{ allowed: number }>();
  return Boolean(allowed);
}
