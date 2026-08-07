import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import {
  inspectScheduleImportRow,
  loadPreviousScheduleIdentities,
  type NormalizedScheduleRow,
} from "../../../../lib/schedule-import-preview";
import { scheduleImportFinalStatus } from "../../../../lib/schedule-import-status";
import { validateNormalizedSchedule } from "../../../../lib/schedule-import";
import { requireTeacherAdminApi } from "../../../../lib/teacher-auth";

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

  const rows = (await env.DB
    .prepare("SELECT * FROM schedule_import_rows WHERE import_id=? ORDER BY row_number")
    .bind(importId)
    .all()).results as Array<Record<string, unknown>>;
  const previousByIdentity = await loadPreviousScheduleIdentities(env.DB, importId);
  const report = {
    created: 0,
    updated: 0,
    skipped: 0,
    blocked: 0,
    studentsCreated: 0,
    remaining: 0,
  };

  for (const row of rows) {
    if (["created", "updated", "skipped"].includes(String(row.action))) {
      continue;
    }
    if (row.lesson_id && String(row.action) === "pending") {
      await env.DB
        .prepare("UPDATE schedule_import_rows SET action='created',issue=NULL WHERE id=?")
        .bind(row.id)
        .run();
      continue;
    }
    try {
      let value: NormalizedScheduleRow;
      try {
        value = JSON.parse(String(row.normalized_data || "{}")) as NormalizedScheduleRow;
      } catch {
        await blockRow(Number(row.id), "课表行数据损坏，请重新上传");
        report.blocked++;
        continue;
      }

      const validationIssues = validateNormalizedSchedule(value);
      const preview = await inspectScheduleImportRow(
        env.DB,
        value,
        validationIssues,
        previousByIdentity,
      );

      if (preview.action === "blocked") {
        await blockRow(Number(row.id), preview.issues.join("；"), preview.existingLessonId);
        report.blocked++;
        continue;
      }

      if (preview.action === "skip") {
        await env.DB
          .prepare("UPDATE schedule_import_rows SET action='skipped',issue=NULL,lesson_id=? WHERE id=?")
          .bind(preview.existingLessonId, row.id)
          .run();
        report.skipped++;
        continue;
      }

      if (preview.action === "update" && preview.existingLessonId) {
        const old = await env.DB
          .prepare("SELECT start_time AS startTime,end_time AS endTime,location FROM lessons WHERE id=?")
          .bind(preview.existingLessonId)
          .first<Record<string, unknown>>();
        if (!old) {
          await blockRow(Number(row.id), "原课时已不存在，请重新上传课表");
          report.blocked++;
          continue;
        }
        await env.DB
          .prepare("UPDATE lessons SET start_time=?,end_time=?,location=?,status='rescheduled',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(
            value.startTime,
            value.endTime,
            value.location,
            `课表重新导入调整；原时间 ${String(old.startTime || "未填")}–${String(old.endTime || "未填")}，原地点 ${String(old.location || "未填")}`,
            preview.existingLessonId,
          )
          .run();
        await env.DB
          .prepare("UPDATE schedule_import_rows SET action='updated',issue=NULL,lesson_id=? WHERE id=?")
          .bind(preview.existingLessonId, row.id)
          .run();
        report.updated++;
        continue;
      }

      const className = value.className ||
        (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
      let classId: number | null = null;
      if (className) {
        let found = await env.DB
          .prepare("SELECT id FROM classes WHERE name=? AND status='active' LIMIT 1")
          .bind(className)
          .first<{ id: number }>();
        if (!found) {
          found = await env.DB
            .prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id")
            .bind(access.id, className, "高中", "待补全", "导入课表", "active")
            .first<{ id: number }>();
        }
        classId = found?.id || null;
      }

      for (const name of value.studentNames || []) {
        let student = await env.DB
          .prepare("SELECT id FROM students WHERE name=? AND status='active' LIMIT 1")
          .bind(name)
          .first<{ id: number }>();
        if (!student) {
          student = await env.DB
            .prepare("INSERT INTO students(name,grade,status,notes) VALUES(?,?,?,?) RETURNING id")
            .bind(name, "待补全", "active", "由课表导入自动创建，资料待补全")
            .first<{ id: number }>();
          if (student) report.studentsCreated++;
        }
        if (classId && student) {
          await env.DB
            .prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,?)")
            .bind(classId, student.id, "active")
            .run();
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
      if (!lesson) {
        await blockRow(Number(row.id), "课时创建失败，请检查后重试");
        report.blocked++;
        continue;
      }

      report.created++;
      await env.DB
        .prepare("UPDATE schedule_import_rows SET action='created',issue=NULL,lesson_id=? WHERE id=?")
        .bind(lesson.id, row.id)
        .run();

      if (value.institution || value.baseFee || value.perStudentFee || value.fee) {
        let institutionId: number | null = null;
        if (value.institution) {
          let institution = await env.DB
            .prepare("SELECT id FROM institutions WHERE name=? LIMIT 1")
            .bind(value.institution)
            .first<{ id: number }>();
          if (!institution) {
            institution = await env.DB
              .prepare("INSERT INTO institutions(name,settlement_cycle) VALUES(?,?) RETURNING id")
              .bind(value.institution, cycle(value.settlementCycle))
              .first<{ id: number }>();
          }
          institutionId = institution?.id || null;
        }
        const expectedAmount = value.fee ||
          value.baseFee + value.perStudentFee * (value.studentNames?.length || 0);
        await env.DB
          .prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,expected_amount,status) VALUES(?,?,?,?,?,?)")
          .bind(
            lesson.id,
            institutionId ? "institution" : "parent",
            institutionId,
            value.baseFee || 0,
            expectedAmount,
            "review",
          )
          .run();
      }
    } catch {
      await blockRow(Number(row.id), "写入中断，请重试剩余行");
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
  await audit(access, finalStatus.status === "confirmed" ? "confirm" : "confirm_retry", "schedule_import", importId, { ...report, status: finalStatus.status });
  return Response.json({ ok: true, status: finalStatus.status, report, rows: resultRows });
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
) {
  await env.DB
    .prepare("UPDATE schedule_import_rows SET action='blocked',issue=?,lesson_id=? WHERE id=?")
    .bind(issue, lessonId, rowId)
    .run();
}

const parseReport = (value: string | null) => {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
};

const cycle = (value: string) =>
  value.includes("次") ? "per_lesson" : value.includes("周") ? "weekly" : "monthly";
