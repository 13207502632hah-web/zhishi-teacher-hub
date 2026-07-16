import { env } from "cloudflare:workers";
import { audit, isDenied, requirePermission } from "../../../lib/access";
import {
  DEMO_SCENARIO_VERSION,
  demoAttendanceStatuses,
  demoFeedbackStatuses,
  demoIsoDate,
  demoLessonScenarios,
  demoQuestionScenarios,
  demoResourceScenarios,
  demoSubmissionStatuses,
} from "../../../lib/demo-scenario";

type Row = { id: number };
const now = () => new Date().toISOString();

const saveRecord = (runId: string, entityType: string, entityId: number) => env.DB.prepare("INSERT INTO demo_records(run_id,entity_type,entity_id) VALUES(?,?,?)").bind(runId, entityType, entityId).run();

const marks = (values: number[]) => values.map(() => "?").join(",") || "NULL";

async function trackedIds(entityType: string) {
  const rows = await env.DB.prepare("SELECT DISTINCT entity_id AS id FROM demo_records WHERE entity_type=? ORDER BY entity_id").bind(entityType).all<Row>();
  return rows.results.map((row) => Number(row.id)).filter(Boolean);
}

async function trackOnce(runId: string, entityType: string, entityId: number) {
  const found = await env.DB.prepare("SELECT id FROM demo_records WHERE run_id=? AND entity_type=? AND entity_id=? LIMIT 1").bind(runId, entityType, entityId).first();
  if (!found) await saveRecord(runId, entityType, entityId);
}

async function demoSummary() {
  const counts = await env.DB.prepare("SELECT entity_type AS entityType,COUNT(DISTINCT entity_id) AS count FROM demo_records WHERE entity_type!='scenario' GROUP BY entity_type").all<{ entityType: string; count: number }>();
  const byType = Object.fromEntries(counts.results.map((row) => [row.entityType, Number(row.count || 0)]));
  const lessonIds = await trackedIds("lesson"), studentIds = await trackedIds("student");
  const [assignments, submissions, finance] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM assignments WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM assignment_submissions WHERE student_id IN (${marks(studentIds)}) AND assignment_id IN (SELECT id FROM assignments WHERE lesson_id IN (${marks(lessonIds)}))`).bind(...studentIds, ...lessonIds).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM lesson_finance WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds).first<{ count: number }>(),
  ]);
  return {
    classes: byType.class || 0,
    students: byType.student || 0,
    lessons: byType.lesson || 0,
    questions: byType.question || 0,
    papers: byType.paper || 0,
    feedback: byType.feedback || 0,
    reflections: byType.reflection || 0,
    assessments: byType.assessment || 0,
    wrongQuestions: byType.wrong_question || 0,
    reviewSets: byType.question_set || 0,
    resources: byType.resource || 0,
    assignments: Number(assignments?.count || 0),
    submissions: Number(submissions?.count || 0),
    finance: Number(finance?.count || 0),
  };
}

async function supplementComprehensiveDemo(access: { id: number; name: string }) {
  const completed = await env.DB.prepare("SELECT id FROM demo_records WHERE run_id=? AND entity_type='scenario' AND entity_id=2 LIMIT 1").bind(DEMO_SCENARIO_VERSION).first();
  const alreadyComplete = Boolean(completed);

  const db = env.DB, classIds = await trackedIds("class"), studentIds = await trackedIds("student"), lessonIds = await trackedIds("lesson");
  if (classIds.length < 2 || studentIds.length < 10 || lessonIds.length < 12) throw new Error("基础演示数据不完整，无法继续补齐综合场景");

  const courses = new Map<number, number>();
  for (const [index, classId] of classIds.entries()) {
    let course = await db.prepare("SELECT id FROM courses WHERE class_id=? AND name LIKE '【演示】%' ORDER BY id LIMIT 1").bind(classId).first<Row>();
    if (!course) course = await db.prepare("INSERT INTO courses(class_id,name,stage,grade,textbook_version,volume) SELECT id,CASE WHEN stage='初中' THEN '【演示】道德与法治系统课' ELSE '【演示】高中思想政治系统课' END,stage,grade,'统编版',CASE WHEN stage='初中' THEN '九年级上册' ELSE '必修3 政治与法治' END FROM classes WHERE id=? RETURNING id").bind(classId).first<Row>();
    if (course) { courses.set(classId, course.id); await trackOnce(DEMO_SCENARIO_VERSION, "course", course.id); }
    await db.prepare("UPDATE classes SET course_type=COALESCE(NULLIF(TRIM(course_type),''),'小班课'),schedule=?,notes=? WHERE id=?").bind(index % 2 ? "每周日 14:00–16:00；必要时周三线上答疑" : "每周六 09:00–11:00；考前安排补课", "【演示】综合运行数据，可在设置中一键清除；不含真实联系方式", classId).run();
  }

  const lessonRows = (await db.prepare(`SELECT id,class_id AS classId FROM lessons WHERE id IN (${marks(lessonIds)}) ORDER BY id`).bind(...lessonIds).all<{ id: number; classId: number }>()).results;
  for (const [index, lesson] of lessonRows.slice(0, demoLessonScenarios.length).entries()) {
    const scenario = demoLessonScenarios[index], isCompleted = ["completed", "makeup"].includes(scenario.status);
    await db.prepare("UPDATE lessons SET course_id=?,date=?,start_time=?,end_time=?,mode=?,location=?,online_link=?,unit=?,topic=?,knowledge_points=?,teaching_goals=?,key_points=?,difficult_points=?,materials=?,activities=?,actual_content=?,homework=?,next_plan=?,participation=?,understanding=?,completion=?,discipline=?,status=?,cancellation_reason=?,fee=?,fee_status=? WHERE id=?")
      .bind(courses.get(Number(lesson.classId)) || null, demoIsoDate(scenario.offsetDays), scenario.startTime, scenario.endTime, scenario.mode, scenario.location, scenario.mode === "online" ? "" : null, scenario.unit, scenario.topic, scenario.knowledge, `掌握${scenario.knowledge}并能结合材料说明`, "提取材料关键词并准确调用教材观点", "把材料信息转化为分层答案", "教材、演示讲义、课堂练习单", "情境导入—观点辨析—限时训练—当堂订正", isCompleted ? `已完成${scenario.topic}的知识梳理与材料训练；个别学生规范表述仍需巩固` : "", isCompleted ? "完成配套题并用错题复盘卡订正" : "课前阅读教材并圈画关键词", "下节先复测错题，再进入下一知识点", isCompleted ? 4 : null, isCompleted ? 4 : null, isCompleted ? 4 : null, isCompleted ? 5 : null, scenario.status, scenario.status === "cancelled" ? "【演示】学生参加学校活动，已与家长确认改期" : scenario.status === "rescheduled" ? "【演示】与校内活动冲突，已调整上课时间" : "", 200 + index * 10, isCompleted ? (index % 3 === 0 ? "unpaid" : "paid") : "untracked", lesson.id).run();
  }

  const existingQuestionIds = await trackedIds("question"), curatedQuestionIds: number[] = [];
  for (const [index, scenario] of demoQuestionScenarios.entries()) {
    const fingerprint = `${DEMO_SCENARIO_VERSION}-question-${index + 1}`;
    let question = await db.prepare("SELECT id FROM questions WHERE fingerprint=? LIMIT 1").bind(fingerprint).first<Row>();
    if (!question) {
      const values = [
        `【演示综合题 ${index + 1}】围绕“${scenario.topic}”完成本题，并说明判断依据。`,
        "【演示材料】某校围绕法治、民主与公共参与组织主题学习，学生结合生活案例开展讨论。",
        ["单选题", "多选题"].includes(scenario.type) ? "A．坚持教材观点并结合材料\nB．脱离材料照抄结论\nC．只写个人感受\nD．用绝对化语言替代分析" : "",
        scenario.type === "判断题" ? "正确" : scenario.type === "填空题" ? "党的领导" : ["单选题", "多选题"].includes(scenario.type) ? "A" : `围绕${scenario.knowledge}，结合材料分层作答。`,
        "先明确设问对象，再提取材料关键词，最后用教材观点组织有逻辑的答案。",
        "依据统编版道德与法治或思想政治教材中与本题知识点对应的基本观点。",
        `本题考查${scenario.knowledge}，结论需以教材表述和材料事实为依据。`,
        "坚持正确价值导向，避免把个人偏好当作事实依据。",
        "审设问—找材料—联教材—分层表达。",
        `规范表述示例：坚持相关制度要求，有利于推进${scenario.topic}的实践。`,
        scenario.type, 2 + index % 4, scenario.score, scenario.stage, scenario.grade, "统编版",
        scenario.stage === "高中" ? "必修3 政治与法治" : "九年级上册", "综合复习", scenario.topic, scenario.knowledge,
        index % 2 ? "法治意识" : "政治认同", index % 3 ? "分析与综合" : "获取和解读信息", "【演示数据】", fingerprint, 1,
        "演示数据,综合验收", access.name, "active", "【演示】仅用于功能体验，答案与解析仍应由教师复核",
      ];
      const columns = "stem,material,options,answer,analysis,fact_basis,textbook_view,value_judgment,answer_logic,standard_expression,question_type,difficulty,score,stage,grade,textbook_version,volume,unit,topic,knowledge_points,core_competencies,ability_level,source,fingerprint,reviewed,tags,recorded_by,status,notes";
      question = await db.prepare(`INSERT INTO questions(${columns}) VALUES(${values.map(() => "?").join(",")}) RETURNING id`).bind(...values).first<Row>();
    }
    if (question) { curatedQuestionIds.push(question.id); await trackOnce(DEMO_SCENARIO_VERSION, "question", question.id); }
  }

  const allQuestionIds = [...new Set([...existingQuestionIds, ...curatedQuestionIds])];
  for (const [index, questionId] of allQuestionIds.entries()) await db.prepare("UPDATE questions SET use_count=?,is_favorite=?,is_frequent=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(index % 5, index % 7 === 0 ? 1 : 0, index % 6 === 0 ? 1 : 0, questionId).run();

  let comprehensivePaper = await db.prepare("SELECT id FROM papers WHERE title='【演示】综合业务验收卷' ORDER BY id LIMIT 1").first<Row>();
  if (!comprehensivePaper) comprehensivePaper = await db.prepare("INSERT INTO papers(title,type,stage,grade,textbook_version,duration_minutes,instructions,total_score,year,academic_year,exam_category,semester,region,school,source,tags,use_status,parse_status,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind("【演示】综合业务验收卷", "阶段测", "初高中", "九年级 / 高一", "统编版", 60, "本卷用于演示题库筛选、组卷、打印和作业关联；正式使用前请教师复核。", curatedQuestionIds.reduce((sum, id, index) => sum + Number(demoQuestionScenarios[index]?.score || (id ? 0 : 0)), 0), new Date().getFullYear(), `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`, "综合验收", "第一学期", "天津", "【演示】知师研室", "【演示数据】", "演示数据,综合组卷", "assigned", "completed", "completed").first<Row>();
  if (comprehensivePaper) {
    await trackOnce(DEMO_SCENARIO_VERSION, "paper", comprehensivePaper.id);
    for (const [position, questionId] of curatedQuestionIds.entries()) {
      const exists = await db.prepare("SELECT id FROM paper_questions WHERE paper_id=? AND question_id=? LIMIT 1").bind(comprehensivePaper.id, questionId).first();
      if (!exists) await db.prepare("INSERT INTO paper_questions(paper_id,question_id,position,score,group_title,answer_space) VALUES(?,?,?,?,?,?)").bind(comprehensivePaper.id, questionId, position + 1, demoQuestionScenarios[position]?.score || 5, position < 4 ? "一、客观题" : "二、主观题", position < 4 ? 1 : 5).run();
    }
  }

  const studentsByClass = new Map<number, number[]>();
  for (const classId of classIds) {
    const rows = await db.prepare(`SELECT e.student_id AS id FROM enrollments e WHERE e.class_id=? AND e.status='active' AND e.student_id IN (${marks(studentIds)}) ORDER BY e.student_id`).bind(classId, ...studentIds).all<Row>();
    studentsByClass.set(classId, rows.results.map((row) => Number(row.id)));
  }

  const completedLessons = (await db.prepare(`SELECT id,class_id AS classId,date FROM lessons WHERE id IN (${marks(lessonIds)}) AND status IN ('completed','makeup') ORDER BY date`).bind(...lessonIds).all<{ id: number; classId: number; date: string }>()).results;
  for (const [lessonIndex, lesson] of completedLessons.entries()) {
    let assignment = await db.prepare("SELECT id FROM assignments WHERE lesson_id=? ORDER BY id LIMIT 1").bind(lesson.id).first<Row>();
    if (!assignment) assignment = await db.prepare("INSERT INTO assignments(lesson_id,paper_id,class_id,title,requirements,due_at,reminder_rule,status) VALUES(?,?,?,?,?,?,?,?) RETURNING id").bind(lesson.id, lessonIndex === completedLessons.length - 1 ? comprehensivePaper?.id || null : null, lesson.classId, `【演示】${lessonIndex + 1} 课后巩固与错题订正`, "完成配套题；主观题使用材料分析四步法；错题写明原因并在一周后复测。", `${demoIsoDate(-27 + lessonIndex * 4)}T21:00`, JSON.stringify({ beforeHours: [24, 3] }), "published").first<Row>();
    if (!assignment) continue;
    await db.prepare("UPDATE assignments SET class_id=?,paper_id=COALESCE(paper_id,?),title=?,requirements=?,due_at=?,reminder_rule=?,status='published',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(lesson.classId, lessonIndex === completedLessons.length - 1 ? comprehensivePaper?.id || null : null, `【演示】${lessonIndex + 1} 课后巩固与错题订正`, "完成配套题；主观题使用材料分析四步法；错题写明原因并在一周后复测。", `${demoIsoDate(-25 + lessonIndex * 4)}T21:00`, JSON.stringify({ beforeHours: [24, 3] }), assignment.id).run();
    await db.prepare("INSERT OR IGNORE INTO assignment_settings(assignment_id,allow_parent_submit,require_revision,published_at) VALUES(?,1,1,CURRENT_TIMESTAMP)").bind(assignment.id).run();
    await db.prepare("INSERT OR IGNORE INTO assignment_targets(assignment_id,target_type,target_id) VALUES(?,'class',?)").bind(assignment.id, lesson.classId).run();
    const members = studentsByClass.get(Number(lesson.classId)) || [];
    for (const [studentIndex, studentId] of members.entries()) {
      const attendanceStatus = demoAttendanceStatuses[(studentIndex + lessonIndex) % demoAttendanceStatuses.length];
      await db.prepare("INSERT INTO attendance(lesson_id,student_id,status,notes) VALUES(?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET status=excluded.status,notes=excluded.notes").bind(lesson.id, studentId, attendanceStatus, `【演示】${attendanceStatus}，用于出勤与计费场景`).run();
      await db.prepare("INSERT INTO student_lesson_records(lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(lesson_id,student_id) DO UPDATE SET participation=excluded.participation,understanding=excluded.understanding,completion=excluded.completion,teacher_note=excluded.teacher_note,risk_tags=excluded.risk_tags,risk_confirmed=excluded.risk_confirmed,updated_at=CURRENT_TIMESTAMP").bind(lesson.id, studentId, 3 + studentIndex % 3, 3 + (studentIndex + lessonIndex) % 3, attendanceStatus === "absent" ? 1 : 4, attendanceStatus === "absent" ? "【演示】本次缺席，信息不足；待补课后再记录表现" : "【演示】能够提取材料关键词并尝试分层作答", studentIndex === 0 && lessonIndex % 2 === 0 ? "规范表述" : "", studentIndex === 0 && lessonIndex % 2 === 0 ? 1 : 0).run();
      const status = demoSubmissionStatuses[(studentIndex + lessonIndex) % demoSubmissionStatuses.length];
      let submission = await db.prepare("SELECT id FROM assignment_submissions WHERE assignment_id=? AND student_id=? ORDER BY id LIMIT 1").bind(assignment.id, studentId).first<Row>();
      if (!submission) submission = await db.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status) VALUES(?,?,?) RETURNING id").bind(assignment.id, studentId, status).first<Row>();
      if (!submission) continue;
      await db.prepare("UPDATE assignment_submissions SET status=?,score=?,review_tags=?,teacher_note=?,submitted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, ["completed", "revision"].includes(status) ? 72 + studentIndex * 5 : null, status === "revision" ? "材料对应不足、答题层次不清" : status === "completed" ? "规范表述" : "", status === "revision" ? "观点基本正确，请补充材料依据并分层表达。" : status === "completed" ? "已完成并订正，注意保持答题层次。" : "", status === "pending" ? null : now(), submission.id).run();
      if (status !== "pending") {
        const version = await db.prepare("SELECT id FROM submission_versions WHERE submission_id=? AND version=1 LIMIT 1").bind(submission.id).first();
        if (!version) await db.prepare("INSERT INTO submission_versions(submission_id,version,text_content,status,submitted_by_role) VALUES(?,1,?,'submitted','student')").bind(submission.id, `【演示作业】学生围绕${demoLessonScenarios[lessonIndex % demoLessonScenarios.length].topic}完成了分层作答和错题订正。`).run();
      }
    }
  }

  const feedbackIds = await trackedIds("feedback");
  for (const [index, feedbackId] of feedbackIds.slice(0, demoFeedbackStatuses.length).entries()) {
    const status = demoFeedbackStatuses[index];
    await db.prepare("UPDATE feedback SET audience=?,length_mode=?,tone=?,content=?,short_content=?,standard_content=?,learning_content=?,highlights=?,consolidate=?,homework_requirements=?,parent_advice=?,next_focus=?,reflection_outline=?,status=?,confirmed_at=?,sent_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(index === 2 ? "guardian" : "private", index ? "standard" : "short", index === 1 ? "客观专业" : "温和鼓励", "【演示】本节已完成知识梳理与材料训练；以下反馈只基于课堂和作业记录。", "本节能够提取材料关键词，规范表述仍需巩固。", "本节围绕核心知识完成了材料分析训练，能够识别主要观点；后续需要加强材料与教材观点的一一对应。", "知识梳理、材料信息提取和分层作答", "能够主动圈画关键词并说明判断依据", "主观题表述层次和教材术语准确性", "完成配套练习，整理错因并在一周后复测", "请关注作业完成过程，不代替学生组织答案", "复测错题后进入下一知识点", "继续观察同类题迁移情况；信息不足处不作推断。", status, status === "draft" ? null : now(), status === "sent" ? now() : null, feedbackId).run();
    const evidence = await db.prepare("SELECT id FROM feedback_evidence WHERE feedback_id=? AND source_type='demo' LIMIT 1").bind(feedbackId).first();
    if (!evidence) await db.prepare("INSERT INTO feedback_evidence(feedback_id,source_type,source_id,label,excerpt,source_date) SELECT ?, 'demo',l.id,'课堂记录',COALESCE(NULLIF(l.actual_content,''),'信息不足'),l.date FROM feedback f JOIN lessons l ON l.id=f.lesson_id WHERE f.id=?").bind(feedbackId, feedbackId).run();
  }

  let secondAssessment = await db.prepare("SELECT id FROM assessments WHERE title='【演示】高一政治单元测验' ORDER BY id LIMIT 1").first<Row>();
  if (!secondAssessment) secondAssessment = await db.prepare("INSERT INTO assessments(class_id,paper_id,title,date,total_score,type,status,notes) VALUES(?,?,?,?,?,?,?,?) RETURNING id").bind(classIds[1], comprehensivePaper?.id || null, "【演示】高一政治单元测验", demoIsoDate(-2), 100, "单元测验", "completed", "【演示】包含客观题和主观题成绩，用于趋势分析").first<Row>();
  if (secondAssessment) {
    await trackOnce(DEMO_SCENARIO_VERSION, "assessment", secondAssessment.id);
    for (const [index, studentId] of (studentsByClass.get(classIds[1]) || []).entries()) await db.prepare("INSERT OR IGNORE INTO assessment_results(assessment_id,student_id,score,objective_score,subjective_score,knowledge_mastery,weak_knowledge,teacher_note) VALUES(?,?,?,?,?,?,?,?)").bind(secondAssessment.id, studentId, 70 + index * 5, 35 + index * 2, 35 + index * 3, index % 2 ? "人民代表大会制度" : "全过程人民民主", index % 2 ? "材料对应" : "规范表述", "【演示】用于成绩趋势与薄弱点分析").run();
  }

  let institution = await db.prepare("SELECT id FROM institutions WHERE name='【演示】知师教研中心' ORDER BY id LIMIT 1").first<Row>();
  if (!institution) institution = await db.prepare("INSERT INTO institutions(name,settlement_cycle,status,notes) VALUES('【演示】知师教研中心','monthly','active','演示机构，不对应真实结算主体') RETURNING id").first<Row>();
  if (institution) {
    await trackOnce(DEMO_SCENARIO_VERSION, "institution", institution.id);
    let rule = await db.prepare("SELECT id FROM pricing_rules WHERE institution_id=? AND payer_type='institution' ORDER BY id LIMIT 1").bind(institution.id).first<Row>();
    if (!rule) rule = await db.prepare("INSERT INTO pricing_rules(institution_id,payer_type,base_fee,per_student_fee,unit_price,effective_from,status) VALUES(?,'institution',100,60,60,?,'active') RETURNING id").bind(institution.id, demoIsoDate(-60)).first<Row>();
    if (rule) await trackOnce(DEMO_SCENARIO_VERSION, "pricing_rule", rule.id);
    const financeIds: number[] = [];
    for (const [index, lesson] of completedLessons.slice(0, 6).entries()) {
      const members = studentsByClass.get(Number(lesson.classId)) || [], expected = 100 + members.length * 60, received = index % 3 === 0 ? expected - 60 : expected;
      let finance = await db.prepare("SELECT id FROM lesson_finance WHERE lesson_id=? LIMIT 1").bind(lesson.id).first<Row>();
      if (!finance) finance = await db.prepare("INSERT INTO lesson_finance(lesson_id,payer_type,payer_id,base_fee,adjustment,expected_amount,received_amount,status,confirmed_at,confirmed_by,pricing_rule_id,calculation_snapshot,note) VALUES(?,'institution',?,100,0,?,?,?,CURRENT_TIMESTAMP,?,?,?,?) RETURNING id").bind(lesson.id, institution.id, expected, received, index === 5 ? "review" : received === expected ? "settled" : "underpaid", access.id, rule?.id || null, JSON.stringify({ demo: true, formula: `100 + ${members.length} × 60`, generatedAt: now() }), "【演示】课时结算快照").first<Row>();
      if (!finance) continue;
      financeIds.push(finance.id);
      for (const [studentIndex, studentId] of members.entries()) {
        const status = demoAttendanceStatuses[(studentIndex + index) % demoAttendanceStatuses.length], factor = ["leave", "absent"].includes(status) ? 0 : 1;
        await db.prepare("INSERT OR IGNORE INTO lesson_billing_items(lesson_finance_id,student_id,attendance_status,billing_factor,unit_fee,amount,reason) VALUES(?,?,?,?,?,?,?)").bind(finance.id, studentId, status, factor, 60, factor * 60, `【演示】${status}，按规则计算`).run();
      }
    }
    if (financeIds.length) {
      let settlement = await db.prepare("SELECT id FROM settlements WHERE payer_type='institution' AND payer_id=? AND note LIKE '【演示】%' ORDER BY id LIMIT 1").bind(institution.id).first<Row>();
      const expected = financeIds.length * 400, received = expected - 60;
      if (!settlement) settlement = await db.prepare("INSERT INTO settlements(payer_type,payer_id,period_start,period_end,expected_amount,received_amount,status,confirmed_at,note) VALUES('institution',?,?,?,?,?,'underpaid',CURRENT_TIMESTAMP,'【演示】月度结算，含一笔待补款') RETURNING id").bind(institution.id, demoIsoDate(-30), demoIsoDate(0), expected, received).first<Row>();
      if (settlement) {
        await trackOnce(DEMO_SCENARIO_VERSION, "settlement", settlement.id);
        for (const financeId of financeIds) await db.prepare("INSERT OR IGNORE INTO settlement_items(settlement_id,lesson_finance_id,expected_amount,received_amount) SELECT ?,id,expected_amount,received_amount FROM lesson_finance WHERE id=?").bind(settlement.id, financeId).run();
      }
    }
  }

  for (const studentId of studentIds.slice(0, 3)) {
    let lessonPackage = await db.prepare("SELECT id FROM lesson_packages WHERE student_id=? AND name='【演示】10次课时包' ORDER BY id LIMIT 1").bind(studentId).first<Row>();
    if (!lessonPackage) lessonPackage = await db.prepare("INSERT INTO lesson_packages(student_id,name,unit_price,purchased_hours,balance_hours,status) VALUES(?,'【演示】10次课时包',200,20,12,'active') RETURNING id").bind(studentId).first<Row>();
    if (lessonPackage) {
      await trackOnce(DEMO_SCENARIO_VERSION, "lesson_package", lessonPackage.id);
      const ledger = await db.prepare("SELECT id FROM package_ledger WHERE package_id=? LIMIT 1").bind(lessonPackage.id).first();
      if (!ledger) await db.prepare("INSERT INTO package_ledger(package_id,type,hours_delta,amount_delta,reason,created_by) VALUES(?,'purchase',20,4000,'【演示】购入课时包',?)").bind(lessonPackage.id, access.id).run();
    }
  }

  for (const resourceScenario of demoResourceScenarios) {
    let resource = await db.prepare("SELECT id FROM resources WHERE title=? ORDER BY id LIMIT 1").bind(resourceScenario.title).first<Row>();
    if (!resource) resource = await db.prepare("INSERT INTO resources(owner_id,title,type,tags,content,source_ref,visibility) VALUES(?,?,?,?,?,'demo:comprehensive','private') RETURNING id").bind(access.id, resourceScenario.title, resourceScenario.type, resourceScenario.tags, resourceScenario.content).first<Row>();
    if (resource) await trackOnce(DEMO_SCENARIO_VERSION, "resource", resource.id);
  }

  const templateName = "【演示】课后闭环七字段模板";
  let template = await db.prepare("SELECT id FROM feedback_templates WHERE name=? ORDER BY id LIMIT 1").bind(templateName).first<Row>();
  if (!template) template = await db.prepare("INSERT INTO feedback_templates(name,audience,tone,opening,closing,style_rules,example_text,is_default,status) VALUES(?,?,?,?,?,?,?,0,'active') RETURNING id").bind(templateName, "guardian", "温和鼓励", "您好，以下为本次课程的客观记录。", "请按建议完成巩固，如有疑问可在下次课前反馈。", "只使用有证据的课堂事实；信息不足必须明示；不使用夸大评价。", "课堂小结—表现亮点—需要巩固—作业建议—下节课计划—家长沟通稿—教学反思提纲").first<Row>();
  if (template) await trackOnce(DEMO_SCENARIO_VERSION, "feedback_template", template.id);

  await trackOnce(DEMO_SCENARIO_VERSION, "scenario", 2);
  return { alreadyComplete, summary: await demoSummary() };
}

export async function GET() {
  const access = await requirePermission("settings:read"); if (isDenied(access)) return access;
  const rows = await env.DB.prepare("SELECT run_id AS runId,COUNT(*) AS count,MAX(created_at) AS createdAt FROM demo_records GROUP BY run_id ORDER BY createdAt DESC").all();
  return Response.json({ runs: rows.results });
}

export async function POST() {
  const access = await requirePermission("settings:write"); if (isDenied(access)) return access;
  const existing = await env.DB.prepare("SELECT id FROM demo_records LIMIT 1").first();
  if (existing) {
    try {
      const result = await supplementComprehensiveDemo(access);
      await audit(access, "seed_demo", "demo", DEMO_SCENARIO_VERSION, { mode: result.alreadyComplete ? "verified" : "supplemented", ...result.summary });
      return Response.json({ ok: true, runId: DEMO_SCENARIO_VERSION, mode: result.alreadyComplete ? "verified" : "supplemented", summary: result.summary }, { status: result.alreadyComplete ? 200 : 201 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "补齐综合演示数据失败" }, { status: 500 });
    }
  }
  const runId = `demo-${Date.now()}`, date = new Date().toISOString().slice(0, 10), db = env.DB;
  const [juniorClass, seniorClass] = await Promise.all([
    db.prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,start_date,schedule,notes,status) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id").bind(access.id, "【演示】初三政治冲刺班", "初中", "九年级", "小班课", date, "每周六 09:00–11:00", "演示数据：可一键清除", "active").first<Row>(),
    db.prepare("INSERT INTO classes(owner_id,name,stage,grade,course_type,start_date,schedule,notes,status) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id").bind(access.id, "【演示】高一政治提高班", "高中", "高一", "小班课", date, "每周日 14:00–16:00", "演示数据：可一键清除", "active").first<Row>(),
  ]);
  if (!juniorClass || !seniorClass) return Response.json({ error: "创建演示班级失败" }, { status: 500 });
  await Promise.all([saveRecord(runId, "class", juniorClass.id), saveRecord(runId, "class", seniorClass.id)]);
  const studentIds: number[] = [];
  for (let index = 0; index < 10; index += 1) { const classId = index < 5 ? juniorClass.id : seniorClass.id, grade = index < 5 ? "九年级" : "高一", student = await db.prepare("INSERT INTO students(name,grade,school,textbook_version,foundation_level,strengths,weak_knowledge,learning_habits,stage_goal,risk_tags,risk_confirmed,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(`【演示】${grade}学生${index + 1}`, grade, "演示学校", "统编版", index % 3 === 0 ? "基础待巩固" : "中等", "材料阅读", index % 3 === 0 ? "法治意识" : "无", "按时完成", index < 5 ? "中考道法提分" : "必修三夯实", index % 4 === 0 ? "知识漏洞" : "", index % 4 === 0 ? 1 : 0, "active", "演示数据：可一键清除").first<Row>(); if (!student) continue; studentIds.push(student.id); await db.prepare("INSERT INTO enrollments(class_id,student_id,status) VALUES(?,?,'active')").bind(classId, student.id).run(); await Promise.all([saveRecord(runId, "student", student.id), saveRecord(runId, "enrollment", student.id)]); }
  const lessonIds: number[] = [], lessonMeta: Array<{ id: number; classId: number; status: string }> = [], lessonStatuses = ["completed", "completed", "completed", "completed", "completed", "completed", "completed", "scheduled", "rescheduled", "cancelled", "makeup", "scheduled"];
  for (let index = 0; index < 12; index += 1) {
    const classId = index % 2 ? seniorClass.id : juniorClass.id, stage = index % 2 ? "高中" : "初中", grade = index % 2 ? "高一" : "九年级", lessonDate = new Date(Date.now() - (11 - index) * 86400000).toISOString().slice(0, 10), topic = index % 2 ? "人民代表大会制度" : "法治中国建设", status = lessonStatuses[index];
    const lesson = await db.prepare("INSERT INTO lessons(class_id,date,start_time,end_time,mode,location,course_name,stage,grade,textbook_version,volume,unit,topic,teaching_goals,key_points,actual_content,homework,next_plan,participation,understanding,completion,status,cancellation_reason,fee,fee_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(classId, lessonDate, index % 2 ? "14:00" : "09:00", index % 2 ? "16:00" : "11:00", "offline", "教室", "【演示】思想政治辅导", stage, grade, "统编版", index % 2 ? "必修3 政治与法治" : "九年级上册", "第二单元", topic, "理解制度优势与法治意义", "结合材料提取观点", status === "completed" || status === "makeup" ? "演示课堂记录" : "", "完成对应练习", "下次进行材料分析", 4, 3, 4, status, status === "cancelled" ? "【演示】学生临时请假" : "", 200, index % 3 ? "paid" : "unpaid").first<Row>();
    if (!lesson) continue; lessonIds.push(lesson.id); lessonMeta.push({ id: lesson.id, classId, status }); await saveRecord(runId, "lesson", lesson.id);
  }
  const questionIds: number[] = [];
  for (let index = 0; index < 30; index += 1) { const stage = index < 15 ? "初中" : "高中", grade = index < 15 ? "九年级" : "高一", type = index % 3 === 0 ? "材料题" : "单选题", stem = `【演示】${stage}政治题 ${index + 1}：请根据材料分析人民当家作主与法治建设的关系。`, fingerprint = `demo-${runId}-${index}`, question = await db.prepare("INSERT INTO questions(stem,material,options,answer,analysis,question_type,difficulty,score,stage,grade,textbook_version,volume,unit,topic,knowledge_points,core_competencies,source,source_file,exam_type,fingerprint,reviewed,tags,recorded_by,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(stem, type === "材料题" ? "【演示材料】全过程人民民主和法治建设相互促进。" : "", type === "单选题" ? "A．人民当家作主\nB．资本决定政治\nC．权力没有约束\nD．法律没有作用" : "", type === "单选题" ? "A" : "围绕人民当家作主、法治保障作答", "演示解析：回扣教材观点并结合材料。", type, index % 5 + 1, type === "单选题" ? 3 : 8, stage, grade, "统编版", stage === "高中" ? "必修3 政治与法治" : "九年级上册", "第二单元", index % 2 ? "人民民主" : "法治中国", index % 2 ? "全过程人民民主" : "法治中国", "政治认同", "【演示数据】", "【演示数据】", "阶段练习", fingerprint, 1, "演示数据", access.name, "active", "演示数据：可一键清除").first<Row>(); if (!question) continue; questionIds.push(question.id); await saveRecord(runId, "question", question.id); }
  for (let index = 0; index < lessonMeta.length; index += 1) {
    const lesson = lessonMeta[index], classStudents = lesson.classId === juniorClass.id ? studentIds.slice(0, 5) : studentIds.slice(5, 10), questionId = questionIds[index % questionIds.length];
    if (questionId && lesson.status !== "cancelled") await db.prepare("INSERT INTO lesson_questions(lesson_id,question_id,purpose,position) VALUES(?,?,?,?)").bind(lesson.id, questionId, "课堂练习", 1).run();
    if (lesson.status !== "completed" && lesson.status !== "makeup") continue;
    const assignment = await db.prepare("INSERT INTO assignments(lesson_id,title,requirements,due_at) VALUES(?,?,?,?) RETURNING id").bind(lesson.id, "【演示】政治课后巩固", "完成对应选择题并整理一条错因", new Date(Date.now() + 2 * 86400000).toISOString()).first<Row>();
    for (let position = 0; position < classStudents.length; position += 1) {
      const studentId = classStudents[position];
      await db.prepare("INSERT INTO attendance(lesson_id,student_id,status,notes) VALUES(?,?,?,?)").bind(lesson.id, studentId, position === 4 && index % 3 === 0 ? "late" : "present", "演示签到").run();
      await db.prepare("INSERT INTO student_lesson_records(lesson_id,student_id,participation,understanding,completion,teacher_note,risk_tags,risk_confirmed) VALUES(?,?,?,?,?,?,?,?)").bind(lesson.id, studentId, 3 + position % 3, 3 + (position + index) % 3, 4, "【演示】能够提取材料关键词", position === 0 && index % 2 === 0 ? "规范表述" : "", position === 0 && index % 2 === 0 ? 1 : 0).run();
      if (assignment) await db.prepare("INSERT INTO assignment_submissions(assignment_id,student_id,status,score,teacher_note,submitted_at) VALUES(?,?,?,?,?,?)").bind(assignment.id, studentId, position === 4 ? "pending" : "completed", position === 4 ? null : 80 + position * 3, "演示作业记录", position === 4 ? null : now()).run();
    }
  }
  for (let index = 0; index < 2; index += 1) { const ids = questionIds.slice(index * 10, index * 10 + 10), paper = await db.prepare("INSERT INTO papers(title,type,stage,grade,textbook_version,duration_minutes,instructions,total_score,status) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id").bind(`【演示】${index ? "高一" : "初三"}政治阶段练习`, "阶段测", index ? "高中" : "初中", index ? "高一" : "九年级", "统编版", 45, "演示试卷：请在规定时间内完成。", ids.length * 5, "draft").first<Row>(); if (!paper) continue; await saveRecord(runId, "paper", paper.id); for (let position = 0; position < ids.length; position += 1) await db.prepare("INSERT INTO paper_questions(paper_id,question_id,position,score) VALUES(?,?,?,?)").bind(paper.id, ids[position], position + 1, 5).run(); }
  const completedLessons = lessonMeta.filter((item) => item.status === "completed" || item.status === "makeup");
  for (let index = 0; index < Math.min(8, completedLessons.length); index += 1) {
    const lessonId = completedLessons[index].id, studentId = studentIds[index % studentIds.length];
    if (!lessonId || !studentId) continue;
    const feedback = await db.prepare("INSERT INTO feedback(lesson_id,student_id,type,tone,content,learning_content,highlights,consolidate,homework_requirements,parent_advice,next_focus,status,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(lessonId, studentId, "lesson", "温和鼓励", "【演示】本节课已完成重点内容梳理，请结合错题巩固。", "人民民主与法治", "能够提取材料观点", "加强规范表述", "完成对应练习并整理错因", "提醒按计划完成巩固", "下次继续训练规范表述", "confirmed", now()).first<Row>();
    if (feedback) await saveRecord(runId, "feedback", feedback.id);
    if (index < 6) {
      const reflection = await db.prepare("INSERT INTO reflections(lesson_id,date,tags,problem_type,expected_vs_actual,effective_practices,difficulties,student_evidence,next_action,action_completed,reusable_material,is_strategy,is_private) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(lessonId, date, "演示数据,材料分析", "教学节奏", "【演示】目标基本达成", "材料圈画关键词有效", "规范表述不完整", "课堂回答记录", "下次先示范答题框架", index % 2, "材料分析四步法", index % 2, 1).first<Row>();
      if (reflection) await saveRecord(runId, "reflection", reflection.id);
    }
  }
  const reviewSet = await db.prepare("INSERT INTO question_sets(name,source_file,source_fingerprint,import_report,status) VALUES(?,?,?,?,?) RETURNING id").bind("【演示】Word 导入待校对试卷", "【演示】高中政治试卷.docx", `demo-review-${runId}`, JSON.stringify({ total: 1, imported: 1, reviewed: 0, incomplete: 1 }), "review").first<Row>();
  if (reviewSet) {
    await saveRecord(runId, "question_set", reviewSet.id);
    const reviewQuestion = await db.prepare("INSERT INTO questions(question_set_id,stem,options,answer,analysis,question_type,difficulty,score,stage,grade,textbook_version,volume,unit,knowledge_points,source,source_file,fingerprint,reviewed,tags,recorded_by,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(reviewSet.id, "【演示待校对】全过程人民民主是最广泛、最真实、最管用的民主。", "A．人民当家作主\nB．资本决定政治", "A", "【待教师核对】请补充排误依据与知识点。", "单选题", 3, 3, "高中", "高一", "统编版", "必修3 政治与法治", "第二单元", "全过程人民民主", "【演示 Word 导入】", "【演示】高中政治试卷.docx", `demo-review-question-${runId}`, 0, "演示数据,待校对", access.name, "review", "演示数据：可一键清除").first<Row>();
    if (reviewQuestion) await saveRecord(runId, "question", reviewQuestion.id);
  }
  const assessment = await db.prepare("INSERT INTO assessments(class_id,title,date) VALUES(?,?,?) RETURNING id").bind(juniorClass.id, "【演示】初三政治阶段测验", date).first<Row>();
  if (assessment) {
    await saveRecord(runId, "assessment", assessment.id);
    for (let index = 0; index < Math.min(5, studentIds.length); index += 1) { const result = await db.prepare("INSERT INTO assessment_results(assessment_id,student_id,score,knowledge_mastery) VALUES(?,?,?,?) RETURNING id").bind(assessment.id, studentIds[index], 68 + index * 5, index % 2 ? "法治意识" : "全过程人民民主").first<Row>(); if (result) await saveRecord(runId, "assessment_result", result.id); }
  }
  const wrongCount = Math.min(10, studentIds.length, questionIds.length);
  for (let index = 0; index < wrongCount; index += 1) { const status = index % 3 === 0 ? "mastered" : "active", wrong = await db.prepare("INSERT INTO wrong_questions(student_id,question_id,lesson_id,incorrect_answer,reason,status,occurred_at,mastered_at) VALUES(?,?,?,?,?,?,?,?) RETURNING id").bind(studentIds[index], questionIds[index], completedLessons[index % completedLessons.length]?.id || null, index % 2 ? "材料要点不完整" : "B", index % 2 ? "规范表述遗漏教材观点" : "混淆人民民主与资本政治", status, now(), status === "mastered" ? now() : null).first<Row>(); if (wrong) await saveRecord(runId, "wrong_question", wrong.id); }
  const comprehensive = await supplementComprehensiveDemo(access), summary = comprehensive.summary;
  await audit(access, "seed_demo", "demo", runId, { mode: "created_and_supplemented", ...summary });
  return Response.json({ ok: true, runId, mode: "created_and_supplemented", summary }, { status: 201 });
}

export async function DELETE(request: Request) {
  const access = await requirePermission("settings:write"); if (isDenied(access)) return access;
  const body = await request.json() as { confirmation?: string }; if (body.confirmation !== "清除演示数据") return Response.json({ error: "请输入“清除演示数据”确认" }, { status: 400 });
  const records = await env.DB.prepare("SELECT run_id AS runId,entity_type AS entityType,entity_id AS entityId FROM demo_records").all<{ runId: string; entityType: string; entityId: number }>();
  if (!records.results.length) return Response.json({ error: "当前没有可清除的演示数据" }, { status: 404 });
  const ids = (type: string) => records.results.filter((row) => row.entityType === type).map((row) => row.entityId), questionIds = ids("question"), lessonIds = ids("lesson"), paperIds = ids("paper"), assessmentIds = ids("assessment"), wrongQuestionIds = ids("wrong_question"), questionSetIds = ids("question_set"), studentIds = ids("student"), classIds = ids("class");
  const assignmentIds = (await env.DB.prepare(`SELECT id FROM assignments WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds).all<Row>()).results.map((row) => Number(row.id));
  const submissionIds = (await env.DB.prepare(`SELECT id FROM assignment_submissions WHERE assignment_id IN (${marks(assignmentIds)})`).bind(...assignmentIds).all<Row>()).results.map((row) => Number(row.id));
  const submissionVersionIds = (await env.DB.prepare(`SELECT id FROM submission_versions WHERE submission_id IN (${marks(submissionIds)})`).bind(...submissionIds).all<Row>()).results.map((row) => Number(row.id));
  const financeIds = (await env.DB.prepare(`SELECT id FROM lesson_finance WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds).all<Row>()).results.map((row) => Number(row.id));
  const packageIds = [...new Set([...ids("lesson_package"), ...(await env.DB.prepare(`SELECT id FROM lesson_packages WHERE student_id IN (${marks(studentIds)}) AND name LIKE '【演示】%'`).bind(...studentIds).all<Row>()).results.map((row) => Number(row.id))])];
  const statements = [
    env.DB.prepare(`DELETE FROM ai_feedback_learning_events WHERE feedback_id IN (${marks(ids("feedback"))})`).bind(...ids("feedback")),
    env.DB.prepare(`UPDATE feedback SET ai_draft_id=NULL WHERE id IN (${marks(ids("feedback"))})`).bind(...ids("feedback")),
    env.DB.prepare(`DELETE FROM ai_feedback_drafts WHERE feedback_id IN (${marks(ids("feedback"))}) OR lesson_id IN (${marks(lessonIds)})`).bind(...ids("feedback"), ...lessonIds),
    env.DB.prepare(`DELETE FROM ai_question_reviews WHERE question_id IN (${marks(questionIds)})`).bind(...questionIds),
    env.DB.prepare(`DELETE FROM feedback_evidence WHERE feedback_id IN (${marks(ids("feedback"))})`).bind(...ids("feedback")),
    env.DB.prepare(`DELETE FROM student_mastery_adjustments WHERE student_id IN (${marks(studentIds)})`).bind(...studentIds),
    env.DB.prepare(`DELETE FROM settlement_items WHERE settlement_id IN (${marks(ids("settlement"))}) OR lesson_finance_id IN (${marks(financeIds)})`).bind(...ids("settlement"), ...financeIds),
    env.DB.prepare(`DELETE FROM settlements WHERE id IN (${marks(ids("settlement"))})`).bind(...ids("settlement")),
    env.DB.prepare(`DELETE FROM package_ledger WHERE package_id IN (${marks(packageIds)})`).bind(...packageIds),
    env.DB.prepare(`DELETE FROM lesson_packages WHERE id IN (${marks(packageIds)})`).bind(...packageIds),
    env.DB.prepare(`DELETE FROM lesson_billing_items WHERE lesson_finance_id IN (${marks(financeIds)})`).bind(...financeIds),
    env.DB.prepare(`DELETE FROM lesson_finance WHERE id IN (${marks(financeIds)})`).bind(...financeIds),
    env.DB.prepare(`DELETE FROM pricing_rules WHERE id IN (${marks(ids("pricing_rule"))})`).bind(...ids("pricing_rule")),
    env.DB.prepare(`DELETE FROM institutions WHERE id IN (${marks(ids("institution"))})`).bind(...ids("institution")),
    env.DB.prepare(`DELETE FROM review_assets WHERE review_id IN (SELECT id FROM submission_reviews WHERE submission_id IN (${marks(submissionIds)}))`).bind(...submissionIds),
    env.DB.prepare(`DELETE FROM submission_reviews WHERE submission_id IN (${marks(submissionIds)})`).bind(...submissionIds),
    env.DB.prepare(`DELETE FROM review_annotations WHERE submission_version_id IN (${marks(submissionVersionIds)})`).bind(...submissionVersionIds),
    env.DB.prepare(`DELETE FROM excellent_submissions WHERE submission_version_id IN (${marks(submissionVersionIds)})`).bind(...submissionVersionIds),
    env.DB.prepare(`DELETE FROM submission_assets WHERE submission_version_id IN (${marks(submissionVersionIds)})`).bind(...submissionVersionIds),
    env.DB.prepare(`DELETE FROM submission_versions WHERE id IN (${marks(submissionVersionIds)})`).bind(...submissionVersionIds),
    env.DB.prepare(`DELETE FROM assignment_assets WHERE assignment_id IN (${marks(assignmentIds)})`).bind(...assignmentIds),
    env.DB.prepare(`DELETE FROM assignment_targets WHERE assignment_id IN (${marks(assignmentIds)})`).bind(...assignmentIds),
    env.DB.prepare(`DELETE FROM assignment_settings WHERE assignment_id IN (${marks(assignmentIds)})`).bind(...assignmentIds),
    env.DB.prepare(`DELETE FROM assignment_submissions WHERE assignment_id IN (${marks(assignmentIds)}) OR student_id IN (${marks(studentIds)})`).bind(...assignmentIds, ...studentIds),
    env.DB.prepare(`DELETE FROM assignments WHERE id IN (${marks(assignmentIds)}) OR lesson_id IN (${marks(lessonIds)})`).bind(...assignmentIds, ...lessonIds),
    env.DB.prepare(`DELETE FROM paper_questions WHERE paper_id IN (${marks(paperIds)})`).bind(...paperIds),
    env.DB.prepare(`DELETE FROM papers WHERE id IN (${marks(paperIds)})`).bind(...paperIds),
    env.DB.prepare(`DELETE FROM lesson_questions WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds),
    env.DB.prepare(`DELETE FROM wrong_questions WHERE id IN (${marks(wrongQuestionIds)}) OR student_id IN (${marks(studentIds)})`).bind(...wrongQuestionIds, ...studentIds),
    env.DB.prepare(`DELETE FROM assessment_results WHERE assessment_id IN (${marks(assessmentIds)})`).bind(...assessmentIds),
    env.DB.prepare(`DELETE FROM assessments WHERE id IN (${marks(assessmentIds)})`).bind(...assessmentIds),
    env.DB.prepare(`DELETE FROM attendance WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds),
    env.DB.prepare(`DELETE FROM student_lesson_records WHERE lesson_id IN (${marks(lessonIds)})`).bind(...lessonIds),
    env.DB.prepare(`DELETE FROM feedback WHERE id IN (${marks(ids("feedback"))})`).bind(...ids("feedback")),
    env.DB.prepare(`DELETE FROM feedback_templates WHERE id IN (${marks(ids("feedback_template"))})`).bind(...ids("feedback_template")),
    env.DB.prepare(`DELETE FROM reflections WHERE id IN (${marks(ids("reflection"))})`).bind(...ids("reflection")),
    env.DB.prepare(`DELETE FROM resources WHERE id IN (${marks(ids("resource"))})`).bind(...ids("resource")),
    env.DB.prepare(`DELETE FROM questions WHERE id IN (${marks(questionIds)})`).bind(...questionIds),
    env.DB.prepare(`DELETE FROM question_sets WHERE id IN (${marks(questionSetIds)})`).bind(...questionSetIds),
    env.DB.prepare(`DELETE FROM lessons WHERE id IN (${marks(lessonIds)})`).bind(...lessonIds),
    env.DB.prepare(`DELETE FROM courses WHERE id IN (${marks(ids("course"))}) OR class_id IN (${marks(classIds)})`).bind(...ids("course"), ...classIds),
    env.DB.prepare(`DELETE FROM enrollments WHERE student_id IN (${marks(studentIds)}) OR class_id IN (${marks(classIds)})`).bind(...studentIds, ...classIds),
    env.DB.prepare(`DELETE FROM staff_class_access WHERE class_id IN (${marks(classIds)})`).bind(...classIds),
    env.DB.prepare(`DELETE FROM students WHERE id IN (${marks(studentIds)})`).bind(...studentIds),
    env.DB.prepare(`DELETE FROM classes WHERE id IN (${marks(classIds)})`).bind(...classIds),
    env.DB.prepare("DELETE FROM demo_records"),
  ];
  await env.DB.batch(statements); await audit(access, "clear_demo", "demo", null, { runs: [...new Set(records.results.map((row) => row.runId))] });
  return Response.json({ ok: true });
}
