import { env } from "cloudflare:workers";
import { calculateLessonFinance, defaultBillingFactor } from "./finance";

type Row = Record<string, any>;

export async function resolvePricingContext(lessonId: number, payerType: string, payerId: number | null) {
  const lesson = await env.DB.prepare("SELECT id,date,class_id AS classId,course_name AS courseName,topic FROM lessons WHERE id=?").bind(lessonId).first<Row>();
  if (!lesson) return null;
  const students = (await env.DB.prepare("SELECT s.id,s.name,a.status AS attendanceStatus,CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS attendanceRecorded,a.notes AS attendanceNote FROM enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN attendance a ON a.lesson_id=? AND a.student_id=s.id WHERE e.class_id=? AND e.status='active' AND s.status='active' ORDER BY s.name").bind(lessonId, lesson.classId || 0).all<Row>()).results;
  let rule: Row | null = null, scopedStudents = students;
  if (payerType === "parent") {
    scopedStudents = payerId ? students.filter((student) => Number(student.id) === payerId) : [];
    if (payerId) rule = await env.DB.prepare("SELECT id,student_id AS studentId,payer_type AS payerType,base_fee AS baseFee,unit_price AS unitPrice,per_student_fee AS perStudentFee,effective_from AS effectiveFrom,effective_to AS effectiveTo FROM pricing_rules WHERE status='active' AND payer_type='parent' AND student_id=? AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?) ORDER BY COALESCE(effective_from,'') DESC,id DESC LIMIT 1").bind(payerId, lesson.date, lesson.date).first<Row>() || null;
  } else if (payerId) rule = await env.DB.prepare("SELECT id,institution_id AS institutionId,payer_type AS payerType,base_fee AS baseFee,unit_price AS unitPrice,per_student_fee AS perStudentFee,effective_from AS effectiveFrom,effective_to AS effectiveTo FROM pricing_rules WHERE status='active' AND payer_type='institution' AND institution_id=? AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?) ORDER BY COALESCE(effective_from,'') DESC,id DESC LIMIT 1").bind(payerId, lesson.date, lesson.date).first<Row>() || null;
  const exceptions: Array<{ type: string; message: string }> = [];
  if (!payerId) exceptions.push({ type: "missing_payer", message: payerType === "parent" ? "请选择对应学生" : "请选择机构" });
  if (payerId && !rule) exceptions.push({ type: "missing_rule", message: "课时日期没有匹配的有效计费规则" });
  for (const student of scopedStudents) if (!student.attendanceRecorded) exceptions.push({ type: "missing_attendance", message: `${student.name}尚未登记出勤` });
  const unitFee = payerType === "parent" ? Number(rule?.unitPrice || rule?.perStudentFee || 0) : Number(rule?.perStudentFee || rule?.unitPrice || 0), baseFee = Number(rule?.baseFee || 0);
  const inputs = scopedStudents.map((student) => ({ studentId: Number(student.id), status: String(student.attendanceStatus || "present"), factor: defaultBillingFactor(String(student.attendanceStatus || "present")), unitFee, reason: student.attendanceRecorded ? `${student.attendanceStatus || "present"}，按规则#${rule?.id || "待补"}计算` : "出勤待补，暂按出勤预览" }));
  const calculation = calculateLessonFinance(baseFee, 0, inputs);
  return { lesson, students, scopedStudents, payerType: payerType === "parent" ? "parent" : "institution", payerId, rule, calculation, exceptions, canConfirm: Boolean(rule && payerId && !exceptions.some((item) => ["missing_rule", "missing_attendance", "missing_payer"].includes(item.type))), source: rule ? { ruleId: rule.id, subject: payerType === "parent" ? `学生#${rule.studentId}` : `机构#${rule.institutionId}`, effectiveFrom: rule.effectiveFrom || "未限定", effectiveTo: rule.effectiveTo || "长期有效", baseFee, unitFee } : null };
}
