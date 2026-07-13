import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../../lib/access";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requirePermission("lessons:write"); if (isDenied(access)) return access;
  const importId = Number((await context.params).id), task = await env.DB.prepare("SELECT status FROM schedule_imports WHERE id=?").bind(importId).first<{ status: string }>();
  if (!task) return Response.json({ error: "导入任务不存在" }, { status: 404 });
  if (task.status === "confirmed") return Response.json({ ok: true, repeated: true });
  const rows = (await env.DB.prepare("SELECT * FROM schedule_import_rows WHERE import_id=? ORDER BY row_number").bind(importId).all()).results as Array<Record<string, any>>;
  const previousRows = (await env.DB.prepare("SELECT sir.lesson_id,sir.normalized_data FROM schedule_import_rows sir JOIN schedule_imports si ON si.id=sir.import_id WHERE si.status='confirmed' AND si.id!=? AND sir.lesson_id IS NOT NULL ORDER BY sir.id DESC").bind(importId).all()).results as Array<Record<string, any>>;
  const previousByIdentity = new Map<string, Record<string, any>>();
  for (const previous of previousRows) { const value = JSON.parse(String(previous.normalized_data || "{}")), key = identity(value); if (!previousByIdentity.has(key)) previousByIdentity.set(key, { ...previous, value }); }
  const report = { created: 0, updated: 0, skipped: 0, blocked: 0, studentsCreated: 0 };
  for (const row of rows) {
    if (row.issue) { report.blocked++; continue; }
    const value = JSON.parse(String(row.normalized_data || "{}")), previous = previousByIdentity.get(identity(value));
    if (previous?.lesson_id) {
      const old = await env.DB.prepare("SELECT l.id,l.status,l.start_time AS startTime,l.end_time AS endTime,l.location,lf.status AS financeStatus FROM lessons l LEFT JOIN lesson_finance lf ON lf.lesson_id=l.id WHERE l.id=?").bind(previous.lesson_id).first<Record<string, any>>();
      const changed = old && (String(old.startTime || "") !== String(value.startTime || "") || String(old.endTime || "") !== String(value.endTime || "") || String(old.location || "") !== String(value.location || ""));
      if (old && !changed) { report.skipped++; await env.DB.prepare("UPDATE schedule_import_rows SET action='skipped',lesson_id=? WHERE id=?").bind(old.id, row.id).run(); continue; }
      if (old && (["completed"].includes(String(old.status)) || !["", "review", "pending"].includes(String(old.financeStatus || "")))) { report.blocked++; await env.DB.prepare("UPDATE schedule_import_rows SET action='blocked',issue=?,lesson_id=? WHERE id=?").bind("原课时已完成或已结算，请在课时详情中人工确认调整", old.id, row.id).run(); continue; }
      if (old && changed) { const conflict = await env.DB.prepare("SELECT id,course_name AS courseName FROM lessons WHERE id!=? AND date=? AND status!='cancelled' AND start_time<? AND end_time>? LIMIT 1").bind(old.id, value.date, value.endTime, value.startTime).first(); if (conflict) { report.blocked++; await env.DB.prepare("UPDATE schedule_import_rows SET action='blocked',issue=?,lesson_id=? WHERE id=?").bind("调整后的时段与其他课程冲突", old.id, row.id).run(); continue; } await env.DB.prepare("UPDATE lessons SET start_time=?,end_time=?,location=?,status='rescheduled',cancellation_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(value.startTime, value.endTime, value.location, `课表重新导入调整；原时间 ${old.startTime}–${old.endTime}，原地点 ${old.location || "未填"}`, old.id).run(); await env.DB.prepare("UPDATE schedule_import_rows SET action='updated',lesson_id=? WHERE id=?").bind(old.id, row.id).run(); report.updated++; continue; }
    }
    const same = await env.DB.prepare("SELECT id,status FROM lessons WHERE date=? AND start_time=? AND course_name=? LIMIT 1").bind(value.date, value.startTime, value.courseName).first<{ id: number; status: string }>();
    if (same) { report.skipped++; await env.DB.prepare("UPDATE schedule_import_rows SET action='skipped',lesson_id=? WHERE id=?").bind(same.id, row.id).run(); continue; }
    let classId: number | null = null; const className = value.className || (value.studentNames?.length ? `${value.studentNames.join("、")}课程` : "");
    if (className) { let found = await env.DB.prepare("SELECT id FROM classes WHERE name=? AND status='active' LIMIT 1").bind(className).first<{ id: number }>(); if (!found) { found = await env.DB.prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,status) VALUES(?,?,?,?,?,?) RETURNING id").bind(access.id, className, "高中", "待补全", "导入课表", "active").first<{ id: number }>(); } classId = found?.id || null; }
    for (const name of value.studentNames || []) { const matches = (await env.DB.prepare("SELECT id FROM students WHERE name=? AND status='active'").bind(name).all()).results as Array<{ id: number }>; if (matches.length > 1) { await env.DB.prepare("UPDATE schedule_import_rows SET action='blocked',issue=? WHERE id=?").bind(`学生“${name}”存在同名档案，请人工选择`, row.id).run(); report.blocked++; classId = null; break; } let student = matches[0]; if (!student) { student = await env.DB.prepare("INSERT INTO students(name,grade,status,notes) VALUES(?,?,?,?) RETURNING id").bind(name, "待补全", "active", "由课表导入自动创建，资料待补全").first<{ id: number }>() as { id: number }; report.studentsCreated++; } if (classId && student) await env.DB.prepare("INSERT OR IGNORE INTO enrollments(class_id,student_id,status) VALUES(?,?,?)").bind(classId, student.id, "active").run(); }
    if (value.studentNames?.length && !classId) continue;
    const lesson = await env.DB.prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,fee,fee_status,status,cancellation_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(classId, value.date, value.startTime, value.endTime, "offline", value.location, value.courseName, "高中", "待补全", value.fee || null, "untracked", "draft", value.notes).first<{ id: number }>();
    if (!lesson) continue; report.created++; await env.DB.prepare("UPDATE schedule_import_rows SET action='created',lesson_id=? WHERE id=?").bind(lesson.id, row.id).run();
    if (value.institution || value.baseFee || value.perStudentFee || value.fee) { let institutionId: number | null = null; if (value.institution) { let inst = await env.DB.prepare("SELECT id FROM institutions WHERE name=? LIMIT 1").bind(value.institution).first<{ id: number }>(); if (!inst) inst = await env.DB.prepare("INSERT INTO institutions(name,settlement_cycle) VALUES(?,?) RETURNING id").bind(value.institution, cycle(value.settlementCycle)).first<{ id: number }>(); institutionId = inst?.id || null; } await env.DB.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,expected_amount,status) VALUES(?,?,?,?,?,?)").bind(lesson.id, institutionId ? "institution" : "parent", institutionId, value.baseFee || 0, value.baseFee || value.fee || 0, "review").run(); }
  }
  await env.DB.prepare("UPDATE schedule_imports SET status='confirmed',report=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(report), importId).run(); await audit(access, "confirm", "schedule_import", importId, report);
  return Response.json({ ok: true, report });
}
const cycle = (value: string) => value.includes("次") ? "per_lesson" : value.includes("周") ? "weekly" : "monthly";
const identity = (value: Record<string, any>) => [value.date, value.className || "", [...(value.studentNames || [])].sort().join("、"), value.courseName || ""].join("|");
