import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("用法: node scripts/repair-demo-records.mjs <本地 D1 sqlite 路径>");
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");

const tableByType = {
  assessment: "assessments",
  assessment_result: "assessment_results",
  class: "classes",
  course: "courses",
  enrollment: "enrollments",
  feedback: "feedback",
  feedback_template: "feedback_templates",
  institution: "institutions",
  lesson: "lessons",
  lesson_package: "lesson_packages",
  paper: "papers",
  pricing_rule: "pricing_rules",
  question: "questions",
  question_set: "question_sets",
  reflection: "reflections",
  resource: "resources",
  settlement: "settlements",
  student: "students",
  wrong_question: "wrong_questions",
};

const types = db.prepare("SELECT DISTINCT entity_type AS type FROM demo_records ORDER BY entity_type").all();
const removed = [];
for (const { type } of types) {
  const table = tableByType[type];
  if (!table) continue;
  const result = db.prepare(`DELETE FROM demo_records WHERE entity_type=? AND entity_id NOT IN (SELECT id FROM ${table})`).run(type);
  if (Number(result.changes) > 0) removed.push({ type, removed: Number(result.changes) });
}

console.log(JSON.stringify({ dbPath, removed, types: types.map((item) => item.type) }, null, 2));
