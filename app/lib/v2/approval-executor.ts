import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { questions } from "../../../db/schema";
import type { AccessContext } from "../access";
import { questionValues } from "../services/question-values";
import { reviewQuestions } from "../services/question-review-service";
import { recordSyncEvent } from "../services/mini-sync-service";
import { confirmFinanceSettlement } from "../finance-confirm";
import { calculateLessonFinance, settlementStatus } from "../finance";
import { previewFingerprint } from "../finance-preview";
import { resolvePricingContext } from "../finance-rules";
import type { V2Approval } from "./contracts";
import { confirmMobileRecordShare } from "./mobile-record-service";
import { confirmRecognition } from "../services/recognition-confirmation";
import { executePromotion, undoPromotion } from "../../api/v2/academic-years/[year]/promotion/route";
import { confirmFeedbackImport } from "../services/feedback-import-confirmation";

const idOf = (approval: V2Approval) => { const id = Number(approval.entityId || approval.payload.id || 0); if (!Number.isInteger(id) || id < 1) throw new Error("建议缺少有效业务编号，未执行"); return id; };
const idsOf = (approval: V2Approval) => { const values = Array.isArray(approval.payload.ids) ? approval.payload.ids : [approval.entityId || approval.payload.id]; const ids = [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 300); if (!ids.length) throw new Error("建议缺少有效业务编号，未执行"); return ids; };
const text = (value: unknown, max = 5000) => String(value || "").trim().slice(0, max);

export async function executeApprovedAction(access: AccessContext, approval: V2Approval) {
  if (access.role !== "teacher") throw new Error("只有主教师可以执行正式确认动作");
  const payload = approval.payload;
  if (approval.actionType === "mobile_record.share") {
    const id = String(approval.entityId || payload.id || ""), version = Number(payload.version || 0);
    const current = await env.DB.prepare("SELECT version,status FROM v2_mobile_records WHERE id=? AND user_id=? AND deleted_at IS NULL").bind(id, access.id).first<{ version: number; status: string }>();
    if (!current) throw new Error("移动记录不存在");
    if (current.status === "confirmed" && Number(current.version) > version) return { executed: true, entityType: "mobile_record", entityId: id, status: "confirmed", repeated: true };
    if (Number(current.version) !== version) throw new Error("移动记录已被修改，请重新提交共享确认");
    const result = await confirmMobileRecordShare(access, id, String(payload.audience || "both") as "student" | "parent" | "both");
    return { executed: true, entityType: "mobile_record", entityId: id, status: "confirmed", recipients: result.recipients };
  }
  if (approval.actionType === "question.promote") {
    const ids = idsOf(approval), result = await reviewQuestions(ids, "confirm");
    if (!result.updated) throw new Error("所选题目均未满足正式入库条件，请先补齐题干、答案、知识点、选项或解析");
    return { executed: true, entityType: "question", entityId: ids.length === 1 ? ids[0] : ids.join(","), status: result.blocked.length ? "partial" : "active", promoted: result.updated, blocked: result.blocked };
  }
  if (approval.actionType === "question.update") {
    const sharedChanges = approval.payload.changes && typeof approval.payload.changes === "object" && !Array.isArray(approval.payload.changes) ? approval.payload.changes as Record<string, unknown> : {};
    const proposedItems = Array.isArray(approval.payload.items) ? approval.payload.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)).slice(0, 100) : idsOf(approval).map((id) => ({ id, changes: sharedChanges, expectedUpdatedAt: approval.payload.expectedUpdatedAt }));
    const ids = [...new Set(proposedItems.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length || proposedItems.some((item) => !item.changes || typeof item.changes !== "object" || Array.isArray(item.changes) || !Object.keys(item.changes as Record<string, unknown>).length)) throw new Error("题目修改建议没有可应用字段");
    let updated = 0;
    for (const proposal of proposedItems) {
      const id = Number(proposal.id), changes = proposal.changes as Record<string, unknown>;
      const [current] = await getDb().select().from(questions).where(eq(questions.id, id)).limit(1);
      if (!current) throw new Error(`题目 #${id} 不存在`);
      if (proposal.expectedUpdatedAt && String(current.updatedAt || "") !== String(proposal.expectedUpdatedAt)) throw new Error(`题目 #${id} 已在建议创建后被修改，请重新核对后提交`);
      const normalized = questionValues({ ...current, ...changes, status: current.status, reviewed: current.reviewed, reviewStatus: current.reviewStatus, recordedBy: access.name });
      if (!normalized.stem) throw new Error(`题目 #${id} 的题干不能为空`);
      const duplicate = await env.DB.prepare("SELECT id FROM questions WHERE fingerprint=? AND id!=? LIMIT 1").bind(normalized.fingerprint, id).first<{ id: number }>();
      if (duplicate) throw new Error(`题目 #${id} 修改后与题目 #${duplicate.id} 高度重复`);
      await getDb().update(questions).set({ ...normalized, status: current.status, reviewed: current.reviewed, reviewStatus: current.reviewStatus, updatedAt: new Date().toISOString() }).where(eq(questions.id, id));
      updated += 1;
    }
    return { executed: true, entityType: "question", entityId: ids.length === 1 ? ids[0] : ids.join(","), status: "updated", updated };
  }
  if (approval.actionType === "question.delete") {
    const ids = idsOf(approval), marks = ids.map(() => "?").join(","), references = await env.DB.prepare(`SELECT q.id,MAX(CASE WHEN pq.id IS NOT NULL THEN 1 ELSE 0 END) AS paperRef,MAX(CASE WHEN lq.id IS NOT NULL THEN 1 ELSE 0 END) AS lessonRef FROM questions q LEFT JOIN paper_questions pq ON pq.question_id=q.id LEFT JOIN lesson_questions lq ON lq.question_id=q.id WHERE q.id IN (${marks}) GROUP BY q.id HAVING paperRef=1 OR lessonRef=1`).bind(...ids).all<{ id: number }>();
    if (references.results.length) throw new Error(`有 ${references.results.length} 道题已被试卷或课时引用，不能删除`);
    await env.DB.batch([env.DB.prepare(`DELETE FROM ai_question_reviews WHERE question_id IN (${marks})`).bind(...ids), env.DB.prepare(`DELETE FROM questions WHERE id IN (${marks})`).bind(...ids)]);
    return { executed: true, entityType: "question", entityId: ids.length === 1 ? ids[0] : ids.join(","), status: "deleted", deleted: ids.length };
  }
  if (approval.actionType === "resource.publish") {
    const id = idOf(approval);
    const resource = await env.DB.prepare("SELECT id,owner_id AS ownerId,title,visibility,url,content FROM resources WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!resource) throw new Error("资源不存在");
    if (access.authType !== "teacher_admin" && Number(resource.ownerId || 0) !== access.id) throw new Error("当前教师只能公开本人创建的资源");
    if (resource.visibility === "public") return { executed: true, entityType: "resource", entityId: id, status: "public", repeated: true };
    if (!text(resource.title, 200) || (!text(resource.content, 20_000) && !text(resource.url, 2_000))) throw new Error("资源标题与内容均未完善，不能公开");
    await env.DB.prepare("UPDATE resources SET visibility='public',updated_at=CURRENT_TIMESTAMP WHERE id=? AND visibility='private'").bind(id).run();
    return { executed: true, entityType: "resource", entityId: id, status: "public" };
  }
  if (approval.actionType === "schedule.adjust") {
    const id = idOf(approval), changes = payload.changes && typeof payload.changes === "object" ? payload.changes as Record<string, unknown> : payload, lesson = await env.DB.prepare("SELECT date,start_time AS startTime,end_time AS endTime,location,status FROM lessons WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!lesson) throw new Error("课时不存在"); if (["completed", "cancelled"].includes(String(lesson.status))) throw new Error("课时已完成或取消，不能自动调整");
    const date = text(changes.date || lesson.date, 10), startTime = text(changes.startTime || lesson.startTime, 5), endTime = text(changes.endTime || lesson.endTime, 5), location = text(changes.location ?? lesson.location, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) throw new Error("调课日期或时间无效");
    const conflict = await env.DB.prepare("SELECT id,course_name AS courseName FROM lessons WHERE id!=? AND date=? AND status!='cancelled' AND start_time<? AND end_time>? LIMIT 1").bind(id, date, endTime, startTime).first<Record<string, unknown>>(); if (conflict) throw new Error(`调整后与“${text(conflict.courseName, 80) || "其他课程"}”冲突`);
    await env.DB.prepare("UPDATE lessons SET date=?,start_time=?,end_time=?,location=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(date, startTime, endTime, location || null, id).run(); return { executed: true, entityType: "lesson", entityId: id, date, startTime, endTime };
  }
  if (approval.actionType === "assignment.publish") {
    const id = idOf(approval), assignment = await env.DB.prepare("SELECT id,title,class_id AS classId,status,due_at AS dueAt FROM assignments WHERE id=?").bind(id).first<Record<string, unknown>>(); if (!assignment) throw new Error("作业不存在");
    const direct = await env.DB.prepare("SELECT target_id AS studentId FROM assignment_targets WHERE assignment_id=? AND target_type='student'").bind(id).all<{ studentId: number }>();
    const students = direct.results.length ? direct.results.map((item) => Number(item.studentId)) : assignment.classId ? (await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(assignment.classId).all<{ studentId: number }>()).results.map((item) => Number(item.studentId)) : [];
    if (!students.length) throw new Error("作业没有可接收的学生，不能发布");
    await env.DB.batch([env.DB.prepare("UPDATE assignments SET status='published',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id), env.DB.prepare("INSERT INTO assignment_settings(assignment_id,published_at) VALUES(?,CURRENT_TIMESTAMP) ON CONFLICT(assignment_id) DO UPDATE SET published_at=COALESCE(assignment_settings.published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP").bind(id)]);
    for (const studentId of students) { await env.DB.prepare("INSERT OR IGNORE INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,'pending')").bind(id, studentId).run(); await recordSyncEvent({ eventType: "assignment.published", entityType: "assignment", entityId: id, studentId, payload: { title: assignment.title, dueAt: assignment.dueAt || null } }); }
    return { executed: true, entityType: "assignment", entityId: id, recipients: students.length, status: "published" };
  }
  if (approval.actionType === "class_file.publish") {
    const id = idOf(approval), file = await env.DB.prepare("SELECT cf.id,cf.class_id AS classId,cf.title,cf.status,c.owner_id AS ownerId,fa.status AS assetStatus FROM class_files cf JOIN classes c ON c.id=cf.class_id JOIN file_assets fa ON fa.id=cf.asset_id WHERE cf.id=?").bind(id).first<Record<string, unknown>>();
    if (!file) throw new Error("班级文件不存在");
    if (file.ownerId != null && Number(file.ownerId) !== access.id) throw new Error("该文件所属班级不在当前教师工作室");
    if (file.assetStatus !== "active" || file.status === "archived") throw new Error("文件已失效或归档，不能发布");
    if (file.status === "published") return { executed: true, entityType: "class_file", entityId: id, status: "published", repeated: true };
    const students = await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(file.classId).all<{ studentId: number }>();
    if (!students.results.length) throw new Error("班级暂无在读学生，不能发布文件");
    await env.DB.prepare("UPDATE class_files SET status='published',published_at=CURRENT_TIMESTAMP,published_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'").bind(access.id, id).run();
    for (const student of students.results) await recordSyncEvent({ eventType: "class_file.published", entityType: "class_file", entityId: id, studentId: Number(student.studentId), payload: { title: file.title, classId: file.classId } });
    return { executed: true, entityType: "class_file", entityId: id, recipients: students.results.length, status: "published" };
  }
  if (approval.actionType === "class_notice.publish") {
    const id = idOf(approval), notice = await env.DB.prepare("SELECT n.id,n.class_id AS classId,n.title,n.status,n.audience_role AS audienceRole,c.owner_id AS ownerId FROM class_notices n JOIN classes c ON c.id=n.class_id WHERE n.id=?").bind(id).first<Record<string, unknown>>();
    if (!notice) throw new Error("家校通知不存在");
    if (notice.ownerId != null && Number(notice.ownerId) !== access.id) throw new Error("该通知所属班级不在当前教师工作室");
    if (notice.status === "archived") throw new Error("通知已撤回，不能发布");
    if (notice.status === "published") return { executed: true, entityType: "class_notice", entityId: id, status: "published", repeated: true };
    const students = await env.DB.prepare("SELECT student_id AS studentId FROM enrollments WHERE class_id=? AND status='active'").bind(notice.classId).all<{ studentId: number }>();
    if (!students.results.length) throw new Error("班级暂无在读学生，不能发布通知");
    await env.DB.prepare("UPDATE class_notices SET status='published',published_at=CURRENT_TIMESTAMP,published_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='draft'").bind(access.id, id).run();
    const audienceRole = notice.audienceRole === "both" ? null : notice.audienceRole as "student" | "parent";
    for (const student of students.results) await recordSyncEvent({ eventType: "class_notice.published", entityType: "class_notice", entityId: id, studentId: Number(student.studentId), audienceRole, payload: { title: notice.title, classId: notice.classId } });
    const recipients = await env.DB.prepare("SELECT COUNT(*) AS count FROM mini_bindings mb JOIN enrollments e ON e.student_id=mb.student_id AND e.status='active' WHERE e.class_id=? AND mb.status='active' AND (?='both' OR mb.role=?)").bind(notice.classId, notice.audienceRole, notice.audienceRole).first<{ count: number }>();
    return { executed: true, entityType: "class_notice", entityId: id, recipients: Number(recipients?.count || 0), status: "published" };
  }
  if (approval.actionType === "submission.review_confirm") {
    const id = idOf(approval), outcome = text(payload.outcome, 30), allowed = new Set(["excellent", "completed", "revision", "incomplete"]);
    if (!allowed.has(outcome)) throw new Error("批改结果无效");
    const submission = await env.DB.prepare("SELECT s.id,s.student_id AS studentId,s.assignment_id AS assignmentId,(SELECT id FROM submission_versions WHERE submission_id=s.id ORDER BY version DESC LIMIT 1) AS versionId FROM assignment_submissions s WHERE s.id=?").bind(id).first<Record<string, unknown>>();
    if (!submission) throw new Error("学生提交不存在");
    if (payload.assignmentId && Number(payload.assignmentId) !== Number(submission.assignmentId)) throw new Error("作业与提交记录不匹配");
    const score = payload.score === "" || payload.score == null ? null : Number(payload.score); if (score !== null && (!Number.isFinite(score) || score < 0)) throw new Error("批改分数无效");
    const note = text(payload.teacherNote, 5000), requirements = text(payload.revisionRequirements, 5000), tags = Array.isArray(payload.reviewTags) ? payload.reviewTags.map((item) => text(item, 80)).filter(Boolean).join("、") : text(payload.reviewTags, 1000), annotation = text(payload.annotation, 5000);
    const reviewAssetIds = [...new Set((Array.isArray(payload.reviewAssetIds) ? payload.reviewAssetIds : []).map(Number).filter((assetId) => Number.isInteger(assetId) && assetId > 0))].slice(0, 12);
    const reviewAssets: Array<{ id: number; mimeType: string }> = [];
    for (const assetId of reviewAssetIds) {
      const asset = await env.DB.prepare("SELECT id,mime_type AS mimeType FROM file_assets WHERE id=? AND status='active' AND ((owner_type='user' AND owner_id=?) OR created_by=?)").bind(assetId, access.id, access.id).first<{ id: number; mimeType: string }>();
      if (!asset) throw new Error("批改附件不存在或已失效");
      reviewAssets.push(asset);
    }
    const review = await env.DB.prepare("INSERT INTO submission_reviews(submission_id,submission_version_id,status,outcome,score,review_tags,teacher_note,revision_requirements,operation_id,reviewed_by,confirmed_at) VALUES(?,?,'confirmed',?,?,?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id").bind(id, submission.versionId || null, outcome, score, tags || null, note || null, requirements || null, `v2-approval:${approval.id}`, access.id).first<{ id: number }>();
    if (!review?.id) throw new Error("批改记录保存失败");
    if (annotation && submission.versionId) await env.DB.prepare("INSERT INTO review_annotations(submission_version_id,type,payload,status,created_by) VALUES(?,'text',?,'confirmed',?)").bind(submission.versionId, JSON.stringify({ text: annotation, source: `v2-approval:${approval.id}` }), access.id).run();
    for (const [position, asset] of reviewAssets.entries()) {
      await env.DB.batch([env.DB.prepare("INSERT INTO review_assets(review_id,asset_id,type,position) VALUES(?,?,?,?)").bind(review.id, asset.id, asset.mimeType.startsWith("audio/") ? "voice" : "attachment", position), env.DB.prepare("INSERT INTO file_leases(asset_id,state,linked_entity_type,linked_entity_id) VALUES(?,'linked','submission_review',?) ON CONFLICT(asset_id) DO UPDATE SET state='linked',linked_entity_type='submission_review',linked_entity_id=excluded.linked_entity_id,updated_at=CURRENT_TIMESTAMP").bind(asset.id, String(review.id))]);
    }
    await env.DB.prepare("UPDATE assignment_submissions SET status=?,score=?,review_tags=?,teacher_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(outcome, score, tags || null, note || null, id).run();
    await recordSyncEvent({ eventType: outcome === "revision" ? "review.revision_required" : "review.confirmed", entityType: "submission", entityId: id, studentId: Number(submission.studentId), payload: { assignmentId: Number(submission.assignmentId), outcome, score, reviewTags: tags ? tags.split("、") : [] } });
    return { executed: true, entityType: "submission", entityId: id, reviewId: review?.id, status: outcome, annotation: Boolean(annotation), reviewAssetCount: reviewAssetIds.length };
  }
  if (approval.actionType === "assessment.complete") {
    const id = idOf(approval), assessment = await env.DB.prepare("SELECT id,total_score AS totalScore,status FROM assessments WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!assessment) throw new Error("测评不存在");
    if (assessment.status === "completed") return { executed: true, entityType: "assessment", entityId: id, status: "completed", repeated: true };
    const summary = await env.DB.prepare("SELECT COUNT(*) AS count,SUM(CASE WHEN score IS NULL OR score<0 OR score>? THEN 1 ELSE 0 END) AS invalid FROM assessment_results WHERE assessment_id=?").bind(Number(assessment.totalScore), id).first<{ count: number; invalid: number }>();
    if (!Number(summary?.count || 0)) throw new Error("尚未录入任何成绩，不能确认完成");
    if (Number(summary?.invalid || 0)) throw new Error("成绩已变化或包含空值、越界值，请重新核对");
    await env.DB.prepare("UPDATE assessments SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status!='completed'").bind(id).run();
    return { executed: true, entityType: "assessment", entityId: id, status: "completed", resultCount: Number(summary?.count || 0) };
  }
  if (approval.actionType === "recognition.confirm") {
    const id = idOf(approval), result = await confirmRecognition(access, id);
    return { executed: true, entityType: "recognition_job", entityId: id, status: "confirmed", ...result };
  }
  if (approval.actionType === "academic_year.promote") {
    const year = text(payload.academicYear || approval.entityId, 20);
    if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("学年格式无效");
    const response = await executePromotion(access, year, { confirmation: "确认晋升", previewToken: payload.previewToken, excludedStudentIds: Array.isArray(payload.excludedStudentIds) ? payload.excludedStudentIds : [] });
    const result = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error(String(result.error || "学年晋升失败"));
    return { executed: true, entityType: "academic_year", entityId: year, status: "confirmed", ...result };
  }
  if (approval.actionType === "academic_year.undo") {
    const year = text(payload.academicYear || approval.entityId, 20);
    if (!/^\d{4}-\d{4}$/.test(year)) throw new Error("学年格式无效");
    const response = await undoPromotion(access, year, { confirmation: "确认撤销晋升", runId: payload.runId, expectedConfirmedAt: payload.expectedConfirmedAt, reason: payload.reason });
    const result = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error(String(result.error || "学年晋升撤销失败"));
    return { executed: true, entityType: "academic_year", entityId: year, status: "undone", ...result };
  }
  if (approval.actionType === "feedback_import.confirm") {
    const id = idOf(approval), result = await confirmFeedbackImport(access, id, { mode: text(payload.mode, 20) || "create", lessonId: Number(payload.lessonId || 0) || undefined });
    return { executed: true, entityType: "feedback_import", entityId: id, status: "confirmed", ...result };
  }
  if (approval.actionType === "feedback.send") {
    const id = idOf(approval), result = await env.DB.prepare("UPDATE feedback SET sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='confirmed'").bind(id).run(); if (Number(result.meta?.changes || 0) < 1) throw new Error("反馈不存在或尚未由教师确认"); return { executed: true, entityType: "feedback", entityId: id, status: "sent" };
  }
  if (approval.actionType === "finance.confirm") {
    const lessonId = idOf(approval), payerType = String(payload.payerType || "") as "institution" | "parent", payerId = payload.payerId == null ? null : Number(payload.payerId), adjustment = Number(payload.adjustment || 0), adjustmentReason = text(payload.adjustmentReason, 1000);
    if (!["institution", "parent"].includes(payerType)) throw new Error("付款方类型无效");
    const context = await resolvePricingContext(lessonId, payerType, payerId); if (!context || !context.canConfirm) throw new Error("计费规则、付款方或出勤记录已变化，请重新提交结算确认");
    const calculation = calculateLessonFinance(context.calculation.baseFee, adjustment, context.calculation.items), fingerprint = await previewFingerprint({ lessonId, lessonDate: context.lesson.date, payerType, payerId, ruleId: context.rule?.id || null, calculation });
    if (fingerprint !== String(payload.fingerprint || "")) throw new Error("结算依据已变化，请重新生成预览");
    const formula = `规则#${context.rule?.id || "待补"}：底薪 ${calculation.baseFee} + 学生计费 ${calculation.items.reduce((sum, item) => sum + item.amount, 0)} + 调整 ${calculation.adjustment} = ${calculation.expectedAmount}`;
    const snapshot = { rule: context.source, lessonDate: context.lesson.date, payerType, payerId, attendance: context.scopedStudents.map((student) => ({ studentId: student.id, name: student.name, status: student.attendanceStatus, recorded: Boolean(student.attendanceRecorded) })), items: calculation.items, baseFee: calculation.baseFee, adjustment, adjustmentReason, expectedAmount: calculation.expectedAmount, fingerprint, operationId: String(payload.operationId), generatedAt: new Date().toISOString(), approvalId: approval.id };
    const response = await confirmFinanceSettlement({ actor: { type: "user", id: access.id }, lessonId, payerType, payerId, adjustment, adjustmentReason, calculation, ruleId: context.rule?.id || null, fingerprint, operationId: String(payload.operationId || `v2-finance:${approval.id}`), formula, snapshot });
    const result = await response.json() as Record<string, unknown>; if (!response.ok) throw new Error(String(result.error || "结算确认失败")); return { executed: true, entityType: "lesson_finance", entityId: result.id || lessonId, status: "pending", calculation, formula };
  }
  if (approval.actionType === "finance.receive") {
    const lessonId = Number(payload.lessonId || 0), financeId = Number(payload.financeId || approval.entityId || 0), receivedAmount = Number(payload.receivedAmount), currentReceived = Number(payload.currentReceived);
    if (!Number.isInteger(lessonId) || lessonId < 1 || !Number.isInteger(financeId) || financeId < 1 || !Number.isFinite(receivedAmount) || receivedAmount < 0) throw new Error("实收确认参数无效");
    const current = await env.DB.prepare("SELECT id,expected_amount AS expectedAmount,received_amount AS receivedAmount,confirmed_at AS confirmedAt FROM lesson_finance WHERE id=? AND lesson_id=?").bind(financeId, lessonId).first<{ id: number; expectedAmount: number; receivedAmount: number; confirmedAt: string | null }>();
    if (!current?.confirmedAt) throw new Error("结算尚未确认，不能登记实收");
    if (Number(current.receivedAmount || 0) !== currentReceived) throw new Error("实收金额已被其他操作更新，请重新提交确认");
    const status = settlementStatus(Number(current.expectedAmount || 0), receivedAmount);
    const result = await env.DB.prepare("UPDATE lesson_finance SET received_amount=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lesson_id=? AND received_amount=? AND confirmed_at IS NOT NULL").bind(receivedAmount, status, financeId, lessonId, currentReceived).run();
    if (Number(result.meta?.changes || 0) !== 1) throw new Error("实收记录已变化，请重新提交确认");
    return { executed: true, entityType: "lesson_finance", entityId: financeId, status, receivedAmount };
  }
  if (approval.actionType === "paper.create_draft") {
    const title = text(payload.title || approval.title, 200); if (!title) throw new Error("试卷草稿缺少标题"); const row = await env.DB.prepare("INSERT INTO papers(title,type,stage,grade,textbook_version,duration_minutes,total_score,status,source) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id").bind(title, text(payload.type || "练习", 50), text(payload.stage, 50) || null, text(payload.grade, 50) || null, text(payload.textbookVersion, 80) || null, Number(payload.durationMinutes || 0) || null, Number(payload.totalScore || 0) || null, "draft", "V2 智能助手待确认建议").first<{ id: number }>(); if (!row) throw new Error("无法创建试卷草稿"); return { executed: true, entityType: "paper", entityId: row.id, status: "draft" };
  }
  if (approval.actionType === "lesson.prepare_draft") {
    const id = idOf(approval), lesson = await env.DB.prepare("SELECT id,teaching_goals AS teachingGoals,key_points AS keyPoints,difficult_points AS difficultPoints,materials,activities,homework FROM lessons WHERE id=?").bind(id).first<Record<string, unknown>>(); if (!lesson) throw new Error("课时不存在");
    await env.DB.prepare("UPDATE lessons SET teaching_goals=?,key_points=?,difficult_points=?,materials=?,activities=?,homework=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(text(payload.teachingGoals ?? lesson.teachingGoals), text(payload.keyPoints ?? lesson.keyPoints), text(payload.difficultPoints ?? lesson.difficultPoints), text(payload.materials ?? lesson.materials), text(payload.activities ?? lesson.activities), text(payload.homework ?? lesson.homework), id).run(); return { executed: true, entityType: "lesson", entityId: id, status: "draft_prepared" };
  }
  if (approval.actionType === "analysis.create_report") {
    const title = text(payload.title || approval.title, 200), content = text(payload.content || approval.summary, 20_000); const row = await env.DB.prepare("INSERT INTO resources(owner_id,title,type,tags,content,source_ref,visibility) VALUES(?,?,?,?,?,?,'private') RETURNING id").bind(access.id, title, "AI 学情报告", "V2,待复核", content, `v2-approval:${approval.id}`).first<{ id: number }>(); if (!row) throw new Error("无法保存分析报告"); return { executed: true, entityType: "resource", entityId: row.id, status: "private" };
  }
  return { executed: false, entityType: approval.entityType, entityId: approval.entityId, status: "adopted_suggestion", notice: "此建议没有自动执行器，已记录教师采纳结果，原业务数据未改变" };
}
