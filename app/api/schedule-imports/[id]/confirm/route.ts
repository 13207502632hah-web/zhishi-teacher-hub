import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";
import {
  inspectScheduleImportRow,
  loadPreviousScheduleIdentities,
  type NormalizedScheduleRow,
} from "../../../../lib/schedule-import-preview";

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requirePermission("lessons:write");
  if (isDenied(access)) return access;

  const importId = Number((await context.params).id);
  const task = await env.DB
    .prepare("SELECT status,report FROM schedule_imports WHERE id=?")
    .bind(importId)
    .first<{ status: string; report: string | null }>();
  if (!task) {
    return Response.json({ error: "导入任务不存在" }, { status: 404 });
  }
  if (task.status === "confirmed") {
    return Response.json({
      ok: true,
      repeated: true,
      report: parseReport(task.report),
    });
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
  };

  for (const row of rows) {
    let value: NormalizedScheduleRow;
    try {
      value = JSON.parse(String(row.normalized_data || "{}")) as NormalizedScheduleRow;
    } catch {
      await blockRow(Number(row.id), "课表行数据损坏，请重新上传");
      report.blocked++;
      continue;
    }

    const validationIssues = row.issue ? [String(row.issue)] : [];
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
  }

  await env.DB
    .prepare("UPDATE schedule_imports SET status='confirmed',report=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(JSON.stringify(report), importId)
    .run();
  await audit(access, "confirm", "schedule_import", importId, report);
  return Response.json({ ok: true, report });
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
