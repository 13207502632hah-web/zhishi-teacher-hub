import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import {
  claimScheduleImportRow,
  loadLessonState,
  markScheduleImportRow,
  reconcileLessonFinance,
} from "../../../../lib/schedule-import-confirm";
import {
  classCacheKey,
  findClassId,
  findStudentRecords,
  lessonUnlockable,
  type ScheduleIdentityCache,
} from "../../../../lib/schedule-import-identity";
import {
  inspectScheduleImportRow,
  loadPreviousScheduleIdentities,
  type NormalizedScheduleRow,
} from "../../../../lib/schedule-import-preview";
import { scheduleImportFinalStatus } from "../../../../lib/schedule-import-status";
import { validateNormalizedSchedule } from "../../../../lib/schedule-import";
import { requireTeacherAdminApi } from "../../../../lib/teacher-auth";

const CONFIRM_CHUNK_SIZE = 50;

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const teacherAdmin = await requireTeacherAdminApi();
  if (teacherAdmin) return teacherAdmin;
  const access = await requirePermission("lessons:write");
  if (isDenied(access)) return access;

  const importId = Number((await context.params).id);
  const task = await env.DB
    .prepare("SELECT status,report,updated_at AS updatedAt FROM schedule_imports WHERE id=?")
    .bind(importId)
    .first<{ status: string; report: string | null; updatedAt: string | null }>();
  if (!task) {
    return Response.json({ error: "导入任务不存在" }, { status: 404 });
  }
  if (task.status === "confirmed") {
    const rows = await readResultRows(importId);
    return Response.json({
      ok: true,
      repeated: true,
      status: "confirmed",
      report: parseReport(task.report),
      rows,
      done: true,
    });
  }
  const claim = await env.DB
    .prepare("UPDATE schedule_imports SET status='confirming',updated_at=CURRENT_TIMESTAMP WHERE id=? AND (status IN ('preview','partial','failed') OR (status='confirming' AND datetime(updated_at)<datetime('now','-3 minutes')))")
    .bind(importId)
    .run();
  if (!Number(claim.meta?.changes || 0)) {
    return Response.json(
      { error: "该导入正在处理中，请稍后刷新查看结果", retryLater: true },
      { status: 409 },
    );
  }

  const identityCache: ScheduleIdentityCache = {
    classIds: new Map(),
    studentIds: new Map(),
    classStudentSets: new Map(),
  };
  const rows = (await env.DB
    .prepare(`
      SELECT * FROM schedule_import_rows
      WHERE import_id=?
        AND (
          processing_state IS NULL
          OR processing_state IN ('pending','failed','blocked','needs_reconcile')
          OR (processing_state='processing' AND datetime(updated_at)<datetime('now','-5 minutes'))
        )
        AND (processing_state IS NULL OR processing_state != 'done')
      ORDER BY row_number
      LIMIT ${CONFIRM_CHUNK_SIZE}
    `)
    .bind(importId)
    .all()).results as Array<Record<string, unknown>>;
  const previousByIdentity = await loadPreviousScheduleIdentities(env.DB, importId);
  const currentImportLessons = (await env.DB
    .prepare("SELECT lesson_id AS lessonId FROM schedule_import_rows WHERE import_id=? AND lesson_id IS NOT NULL AND (action IN ('created','updated') OR processing_state='needs_reconcile')")
    .bind(importId)
    .all()).results as Array<{ lessonId: number }>;
  const currentImportLessonIds = new Set(
    currentImportLessons.map((row) => Number(row.lessonId)),
  );
  const report = {
    created: 0,
    updated: 0,
    skipped: 0,
    blocked: 0,
    studentsCreated: 0,
    remaining: 0,
  };

  for (const row of rows) {
    const rowId = Number(row.id);
    const action = String(row.action || "");
    const state = String(row.processing_state || "");
    if (["created", "updated", "skipped"].includes(action) && state === "done") {
      continue;
    }

    let value: NormalizedScheduleRow;
    try {
      value = JSON.parse(String(row.normalized_data || "{}")) as NormalizedScheduleRow;
    } catch {
      await blockRow(rowId, "课表行数据损坏，请重新上传", null, "failed");
      report.blocked++;
      continue;
    }

    if (row.lesson_id && action === "skipped") {
      await markScheduleImportRow(env.DB, rowId, {
        action: "skipped",
        state: "done",
        lessonId: Number(row.lesson_id),
      });
      report.skipped++;
      continue;
    }
    if (row.lesson_id && ["created", "updated"].includes(action) && state !== "done") {
      const finalized = await finalizeInterruptedRow(rowId, Number(row.lesson_id), value, action as "created" | "updated");
      if (finalized && action === "created") report.created++;
      else if (finalized) report.updated++;
      else report.blocked++;
      continue;
    }
    if (row.lesson_id && action === "blocked" && state === "needs_reconcile") {
      const finalized = await finalizeInterruptedRow(rowId, Number(row.lesson_id), value, "created");
      if (finalized) report.created++;
      else report.blocked++;
      continue;
    }

    const claimed = await claimScheduleImportRow(env.DB, rowId);
    if (!claimed) {
      await blockRow(rowId, "该行正在处理中，请稍后重试", null, "blocked");
      report.blocked++;
      continue;
    }

    try {
      const validationIssues = validateNormalizedSchedule(value);
      const preview = await inspectScheduleImportRow(
        env.DB,
        value,
        validationIssues,
        previousByIdentity,
        {
          ownerId: access.id,
          sourceLineage: String(row.source_lineage || ""),
          sourceRowId: String(row.source_row_id || ""),
          currentImportLessonIds,
          cache: identityCache,
        },
      );

      if (preview.action === "blocked") {
        await blockRow(rowId, preview.issues.join("；"), preview.existingLessonId, "blocked");
        report.blocked++;
        continue;
      }

      if (preview.action === "skip") {
        await markScheduleImportRow(env.DB, rowId, {
          action: "skipped",
          state: "done",
          lessonId: preview.existingLessonId,
        });
        report.skipped++;
        continue;
      }

      if (preview.action === "update" && preview.existingLessonId) {
        const old = await loadLessonState(env.DB, preview.existingLessonId);
        if (!old) {
          await blockRow(rowId, "原课时已不存在，请重新上传课表", preview.existingLessonId, "blocked");
          report.blocked++;
          continue;
        }
        if (!lessonUnlockable(old)) {
          await blockRow(
            rowId,
            "原课时已完成或已结算，请在课时详情中人工确认调整",
            preview.existingLessonId,
            "blocked",
          );
          report.blocked++;
          continue;
        }
        const outcome = await applyLessonUpdate(rowId, value, old, preview.existingLessonId, access.id, identityCache);
        if (outcome === "done") {
          report.updated++;
        } else {
          report.blocked++;
        }
        continue;
      }

      const className = value.className ||
        (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
      let classId: number | null = null;
      if (className) {
        let found = await findClassId(env.DB, className, access.id, identityCache);
        if (!found) {
          const created = await env.DB
            .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
            .bind(access.id, className, "高中", "待补全", "导入课表", "active")
            .first<{ id: number }>();
          found = created?.id ?? null;
          identityCache.classIds?.set(classCacheKey(className, access.id), found);
        }
        classId = found;
      }

      let lessonId: number | null = null;
      try {
        for (const name of value.studentNames || []) {
          const studentIds = await findStudentRecords(env.DB, name, identityCache);
          if (studentIds.length > 1) {
            throw new Error(`学生“${name}”存在同名档案，请人工选择`);
          }
          let studentId = studentIds[0] ?? null;
          if (!studentId) {
            const student = await env.DB
              .prepare("INSERT INTO students(name,grade,status,notes) VALUES(?,?,?,?) RETURNING id")
              .bind(name, "待补全", "active", "由课表导入自动创建，资料待补全")
              .first<{ id: number }>();
            if (student) {
              studentId = Number(student.id);
              identityCache.studentIds?.set(name, [studentId]);
              report.studentsCreated++;
            }
          }
          if (classId && studentId) {
            await env.DB
              .prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,?)")
              .bind(classId, studentId, "active")
              .run();
            if (identityCache.classStudentSets?.has(classId)) {
              identityCache.classStudentSets.get(classId)?.add(studentId);
            }
          }
        }

        const lesson = await env.DB
          .prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,fee,fee_status,status,cancellation_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
          .bind(
            classId,
            value.date,
            value.startTime,
            value.endTime,
            "offline",
            value.location,
            value.courseName,
            "高中",
            "待补全",
            value.fee || null,
            "untracked",
            "draft",
            value.notes,
          )
          .first<{ id: number }>();
        if (!lesson) throw new Error("课时创建失败，请检查后重试");
        lessonId = Number(lesson.id);
        currentImportLessonIds.add(lessonId);

        await env.DB
          .prepare("UPDATE schedule_import_rows SET action='created',issue=NULL,lesson_id=?,processing_state='processing' WHERE id=?")
          .bind(lessonId, rowId)
          .run();
        await reconcileLessonFinance(env.DB, lessonId, value);
        await markScheduleImportRow(env.DB, rowId, {
          action: "created",
          state: "done",
          lessonId,
        });
        report.created++;
      } catch (error) {
        const message = errorMessage(error);
        await blockRow(
          rowId,
          message,
          lessonId,
          lessonId ? "needs_reconcile" : "failed",
          message,
        );
        report.blocked++;
      }
    } catch {
      await blockRow(rowId, "写入中断，请重试剩余行", null, "failed");
      report.blocked++;
    }
  }

  const resultRows = await readResultRows(importId);
  const finalStatus = scheduleImportFinalStatus(resultRows);
  report.remaining = finalStatus.remaining;
  await env.DB
    .prepare("UPDATE schedule_imports SET status=?,report=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(finalStatus.status, JSON.stringify(report), importId)
    .run();
  try {
    await audit(access, finalStatus.status === "confirmed" ? "confirm" : "confirm_retry", "schedule_import", importId, { ...report, status: finalStatus.status });
  } catch {
    // 审计失败不应把已经完成的业务写入标记为失败。
  }
  return Response.json({
    ok: true,
    status: finalStatus.status,
    report,
    rows: resultRows,
    done: rows.length < CONFIRM_CHUNK_SIZE || finalStatus.status === "confirmed",
    processed: rows.length,
  });
}

async function finalizeInterruptedRow(
  rowId: number,
  lessonId: number,
  value: NormalizedScheduleRow,
  action: "created" | "updated",
): Promise<boolean> {
  try {
    await reconcileLessonFinance(env.DB, lessonId, value);
    await markScheduleImportRow(env.DB, rowId, { action, state: "done", lessonId });
    return true;
  } catch (error) {
    await blockRow(
      rowId,
      errorMessage(error),
      lessonId,
      "needs_reconcile",
      errorMessage(error),
    );
    return false;
  }
}

async function applyLessonUpdate(
  rowId: number,
  value: NormalizedScheduleRow,
  old: Record<string, unknown>,
  lessonId: number,
  ownerId: number,
  cache?: ScheduleIdentityCache,
): Promise<"done" | "blocked"> {
  let targetClassId = old.classId ? Number(old.classId) : null;
  const className = value.className ||
    (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
  let mutated = false;
  try {
    if (className) {
      let found = await findClassId(env.DB, className, ownerId, cache);
      if (!found) {
        const created = await env.DB
          .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
          .bind(ownerId, className, "高中", "待补全", "导入课表", "active")
          .first<{ id: number }>();
        found = created?.id ?? null;
        cache?.classIds?.set(classCacheKey(className, ownerId), found);
      }
      targetClassId = found;
      for (const name of value.studentNames || []) {
        const studentIds = await findStudentRecords(env.DB, name, cache);
        if (studentIds.length > 1) {
          throw new Error(`学生“${name}”存在同名档案，请人工选择`);
        }
        let studentId = studentIds[0] ?? null;
        if (!studentId) {
          const student = await env.DB
            .prepare("INSERT INTO students(name,grade,status,notes) VALUES(?,?,?,?) RETURNING id")
            .bind(name, "待补全", "active", "由课表导入自动创建，资料待补全")
            .first<{ id: number }>();
          if (student) {
            studentId = Number(student.id);
            cache?.studentIds?.set(name, [studentId]);
          }
        }
        if (targetClassId && studentId) {
          await env.DB
            .prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,?)")
            .bind(targetClassId, studentId, "active")
            .run();
          if (cache?.classStudentSets?.has(targetClassId)) {
            cache.classStudentSets.get(targetClassId)?.add(studentId);
          }
        }
      }
    }
    await env.DB.batch([
      env.DB
        .prepare("UPDATE lessons SET class_id=?,date=?,start_time=?,end_time=?,mode=?,location=?,course_name=?,fee=?,fee_status='untracked',status='rescheduled',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(
          targetClassId,
          value.date,
          value.startTime,
          value.endTime,
          "offline",
          value.location,
          value.courseName,
          value.fee || null,
          `课表重新导入调整；原时间 ${String(old.startTime || "未填")}–${String(old.endTime || "未填")}，原地点 ${String(old.location || "未填")}`,
          lessonId,
        ),
      env.DB
        .prepare("UPDATE schedule_import_rows SET action='updated',issue=NULL,lesson_id=?,processing_state='processing' WHERE id=?")
        .bind(lessonId, rowId),
    ]);
    mutated = true;
    await reconcileLessonFinance(env.DB, lessonId, value);
    await markScheduleImportRow(env.DB, rowId, {
      action: "updated",
      state: "done",
      lessonId,
    });
    return "done";
  } catch (error) {
    const message = errorMessage(error);
    await blockRow(
      rowId,
      message,
      mutated ? lessonId : null,
      mutated ? "needs_reconcile" : "blocked",
      message,
    );
    return "blocked";
  }
}

async function readResultRows(importId: number) {
  const rows = (await env.DB
    .prepare(
      "SELECT id,row_number AS rowNumber,action,issue,lesson_id AS lessonId FROM schedule_import_rows WHERE import_id=? ORDER BY row_number",
    )
    .bind(importId)
    .all()).results;
  return rows as Array<{
    id: number;
    rowNumber: number;
    action: string;
    issue: string | null;
    lessonId: number | null;
  }>;
}

async function blockRow(
  rowId: number,
  issue: string,
  lessonId: number | null = null,
  state: "blocked" | "failed" | "needs_reconcile" = "blocked",
  lastError?: string,
) {
  await env.DB
    .prepare("UPDATE schedule_import_rows SET action='blocked',issue=?,lesson_id=COALESCE(?,lesson_id),processing_state=?,last_error=? WHERE id=?")
    .bind(issue, lessonId, state, lastError ?? issue, rowId)
    .run();
}

const parseReport = (value: string | null) => {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "写入中断，请重试剩余行";
