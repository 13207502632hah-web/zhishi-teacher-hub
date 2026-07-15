import { promotionForGrade } from "../academic-workflow";

export async function ensurePromotionRun(db: D1Database, academicYear: string) {
  await db.prepare("INSERT OR IGNORE INTO grade_promotion_runs(academic_year,status) VALUES(?,'preview')").bind(academicYear).run();
  const run = await db.prepare("SELECT * FROM grade_promotion_runs WHERE academic_year=?").bind(academicYear).first<Record<string, unknown>>();
  if (run?.status === "preview") {
    const students = (await db.prepare("SELECT id,grade FROM students WHERE status='active'").all<{ id: number; grade: string }>()).results;
    const items = students.flatMap((student) => {
      const toGrade = promotionForGrade(student.grade);
      return toGrade
        ? [db.prepare("INSERT OR IGNORE INTO grade_promotion_items(run_id,student_id,from_grade,to_grade,action,status) VALUES(?,?,?,?,?,'pending')").bind(run.id, student.id, student.grade, toGrade, toGrade === "毕业" ? "graduate" : "promote")]
        : [];
    });
    if (items.length) await db.batch(items);
  }
  return run;
}
