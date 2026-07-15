import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const baseUrl = "http://localhost:3000";
const marker = "__e2e__teaching_loop";
const devVars = path.join(root, ".dev.vars.e2e");
const reportPath = path.join(root, "outputs", "teaching-loop-e2e.json");
const logs = [];
let server;

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function findDatabase(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findDatabase(full);
      if (found) return found;
    } else if (entry.name.endsWith(".sqlite") && !entry.name.startsWith("metadata")) {
      const tables = execFileSync("sqlite3", [full, ".tables"], { encoding: "utf8" });
      if (tables.includes("lessons") && tables.includes("lesson_finance")) return full;
    }
  }
  return null;
}

const database = await findDatabase(path.join(root, ".wrangler", "state", "v3", "d1"));
assert.ok(database?.includes(`${path.sep}.wrangler${path.sep}state${path.sep}`), "只允许使用项目本地 D1");

function sql(statement) {
  return execFileSync("sqlite3", [database, ".timeout 5000", statement], { encoding: "utf8" }).trim();
}

function rows(statement) {
  const output = execFileSync("sqlite3", ["-json", database, ".timeout 5000", statement], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

function cleanup() {
  const lessonIds = `SELECT id FROM lessons WHERE topic LIKE ${quote(`${marker}%`)}`;
  const classIds = `SELECT id FROM classes WHERE name LIKE ${quote(`${marker}%`)}`;
  const studentIds = `SELECT id FROM students WHERE name LIKE ${quote(`${marker}%`)}`;
  const assignmentIds = `SELECT id FROM assignments WHERE lesson_id IN (${lessonIds})`;
  const financeIds = `SELECT id FROM lesson_finance WHERE lesson_id IN (${lessonIds})`;
  const importIds = `SELECT id FROM schedule_imports WHERE source_name LIKE ${quote(`${marker}%`)}`;
  sql(`PRAGMA foreign_keys=ON;
    DELETE FROM audit_logs WHERE entity_type='lesson' AND CAST(entity_id AS INTEGER) IN (${lessonIds});
    DELETE FROM lesson_billing_items WHERE lesson_finance_id IN (${financeIds});
    DELETE FROM lesson_finance WHERE lesson_id IN (${lessonIds});
    DELETE FROM assignment_submissions WHERE assignment_id IN (${assignmentIds});
    DELETE FROM assignments WHERE lesson_id IN (${lessonIds});
    DELETE FROM feedback WHERE lesson_id IN (${lessonIds});
    DELETE FROM attendance WHERE lesson_id IN (${lessonIds});
    DELETE FROM student_lesson_records WHERE lesson_id IN (${lessonIds});
    DELETE FROM schedule_import_rows WHERE import_id IN (${importIds});
    DELETE FROM schedule_imports WHERE id IN (${importIds});
    DELETE FROM lessons WHERE id IN (${lessonIds});
    DELETE FROM enrollments WHERE class_id IN (${classIds}) OR student_id IN (${studentIds});
    DELETE FROM pricing_rules WHERE student_id IN (${studentIds});
    DELETE FROM students WHERE id IN (${studentIds});
    DELETE FROM classes WHERE id IN (${classIds});`);
}

function seed(round) {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const dueAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 5 * 86_400_000));
  const className = `${marker}_class_${round}`;
  const topic = `${marker}_lesson_${round}`;
  sql(`PRAGMA foreign_keys=ON;
    INSERT INTO classes(name,stage,grade,course_type,status) VALUES(${quote(className)},'高中','高一','一对多','active');
    INSERT INTO students(name,grade,status) VALUES(${quote(`${marker}_student_a_${round}`)},'高一','active');
    INSERT INTO students(name,grade,status) VALUES(${quote(`${marker}_student_b_${round}`)},'高一','active');
    INSERT INTO enrollments(class_id,student_id,status)
      SELECT c.id,s.id,'active' FROM classes c,students s WHERE c.name=${quote(className)} AND s.name LIKE ${quote(`${marker}_student_%_${round}`)};
    INSERT INTO lessons(class_id,date,start_time,end_time,course_name,stage,grade,topic,teaching_goals,status,fee)
      SELECT id,${quote(today)},'08:00','09:30','道德与法治','高中','高一',${quote(topic)},'完成合成回归','scheduled',999 FROM classes WHERE name=${quote(className)};
    INSERT INTO schedule_imports(source_name,fingerprint,status) VALUES(${quote(`${marker}_import_${round}`)},${quote(`${marker}_fingerprint_${round}`)},'committed');
    INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,lesson_id)
      SELECT i.id,1,'{}',${quote(JSON.stringify({ baseFee: 100, perStudentFee: 50, institution: marker }))},'created',l.id
      FROM schedule_imports i,lessons l WHERE i.source_name=${quote(`${marker}_import_${round}`)} AND l.topic=${quote(topic)};`);
  const lesson = rows(`SELECT id FROM lessons WHERE topic=${quote(topic)}`)[0];
  const students = rows(`SELECT s.id FROM students s JOIN enrollments e ON e.student_id=s.id JOIN lessons l ON l.class_id=e.class_id WHERE l.id=${lesson.id} ORDER BY s.id`);
  assert.equal(students.length, 2);
  return { lessonId: Number(lesson.id), studentIds: students.map((item) => Number(item.id)), topic, dueAt };
}

async function request(pathname, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { text: text.slice(0, 300) }; }
  return { response, data };
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`本地服务启动超时：${logs.slice(-8).join("\n")}`);
}

async function login() {
  const unauthenticated = await request("/api/dashboard");
  assert.equal(unauthenticated.response.status, 401);
  const { response, data } = await request("/api/auth/login", { method: "POST", body: { account: marker, password: "Politics2026Secure", returnTo: "/workspace" } });
  assert.equal(response.status, 200, JSON.stringify(data));
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("zhishi_teacher_admin="));
  return cookie;
}

async function exerciseRound(round, cookie) {
  cleanup();
  const { lessonId, studentIds, topic, dueAt } = seed(round);
  const dashboard = await request("/api/dashboard", { cookie });
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.data.todayLessons.some((lesson) => lesson.id === lessonId && lesson.topic === topic));

  const baseRecords = [
    { studentId: studentIds[0], attendanceStatus: "present", participation: 5, understanding: 4, completion: 5 },
    { studentId: studentIds[1], attendanceStatus: "leave", participation: 3, understanding: 3, completion: 3 },
  ];
  let result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "completeLesson", actualContent: "", records: baseRecords } });
  assert.equal(result.response.status, 422);
  result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { action: "completeLesson", actualContent: "人民民主专题", records: baseRecords.slice(0, 1) } });
  assert.equal(result.response.status, 422);

  const payload = {
    action: "saveDraft", actualContent: "人民民主专题", homework: "完成巩固练习", nextPlan: "",
    participation: 4, understanding: 4, completion: 4, discipline: 5, records: baseRecords,
  };
  result = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: payload });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(rows(`SELECT status FROM lessons WHERE id=${lessonId}`)[0].status, "scheduled");

  const completion = {
    ...payload, action: "completeLesson",
    assignment: { title: `${marker}_assignment_${round}`, requirements: "完成合成练习", dueAt },
    feedback: { tone: "专业简洁", content: `${marker}_feedback_${round}` },
  };
  const first = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: completion });
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, "completed");
  assert.deepEqual(first.data.todos, ["补充下节课计划"]);
  const second = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: completion });
  assert.equal(second.response.status, 200, JSON.stringify(second.data));

  const counts = rows(`SELECT
    (SELECT COUNT(*) FROM assignments WHERE lesson_id=${lessonId}) AS assignments,
    (SELECT COUNT(*) FROM assignment_submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.lesson_id=${lessonId}) AS submissions,
    (SELECT COUNT(*) FROM feedback WHERE lesson_id=${lessonId}) AS feedback,
    (SELECT COUNT(*) FROM lesson_finance WHERE lesson_id=${lessonId}) AS finance,
    (SELECT COUNT(*) FROM lesson_billing_items b JOIN lesson_finance f ON f.id=b.lesson_finance_id WHERE f.lesson_id=${lessonId}) AS billing,
    (SELECT COUNT(*) FROM attendance WHERE lesson_id=${lessonId}) AS attendance,
    (SELECT expected_amount FROM lesson_finance WHERE lesson_id=${lessonId}) AS expectedAmount`)[0];
  assert.deepEqual({ assignments: counts.assignments, submissions: counts.submissions, feedback: counts.feedback, finance: counts.finance, billing: counts.billing, attendance: counts.attendance }, { assignments: 1, submissions: 2, feedback: 1, finance: 1, billing: 2, attendance: 2 });
  assert.equal(Number(counts.expectedAmount), 150);

  sql(`UPDATE feedback SET status='confirmed',content=${quote(`${marker}_confirmed_${round}`)} WHERE lesson_id=${lessonId};
    UPDATE lesson_finance SET status='confirmed',note=${quote(`${marker}_finance_locked_${round}`)} WHERE lesson_id=${lessonId};`);
  const protectedRun = await request(`/api/lessons/${lessonId}/activity`, { cookie, method: "POST", body: { ...completion, actualContent: "重复完成后的内容", feedback: { content: `${marker}_must_not_overwrite_${round}` } } });
  assert.equal(protectedRun.response.status, 200, JSON.stringify(protectedRun.data));
  assert.equal(protectedRun.data.artifacts.financeLocked, true);
  const protectedRows = rows(`SELECT
    (SELECT COUNT(*) FROM feedback WHERE lesson_id=${lessonId}) AS feedbackCount,
    (SELECT content FROM feedback WHERE lesson_id=${lessonId}) AS feedbackContent,
    (SELECT status FROM lesson_finance WHERE lesson_id=${lessonId}) AS financeStatus,
    (SELECT note FROM lesson_finance WHERE lesson_id=${lessonId}) AS financeNote`)[0];
  assert.equal(protectedRows.feedbackCount, 1);
  assert.equal(protectedRows.feedbackContent, `${marker}_confirmed_${round}`);
  assert.equal(protectedRows.financeStatus, "confirmed");
  assert.equal(protectedRows.financeNote, `${marker}_finance_locked_${round}`);
  return { round, lessonId, idempotent: true, expectedAmount: 150, protectedArtifacts: true };
}

try {
  await writeFile(devVars, `TEACHER_ADMIN_ACCOUNT=${marker}\nTEACHER_ADMIN_PASSWORD=Politics2026Secure\nTEACHER_ADMIN_SESSION_SECRET=${marker}_session_secret_2026\n`, { mode: 0o600 });
  server = spawn("pnpm", ["dev"], { cwd: root, env: { ...process.env, CLOUDFLARE_ENV: "e2e" }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => logs.push(String(chunk).trim()));
  await waitForServer();
  const cookie = await login();
  const rounds = [await exerciseRound(1, cookie), await exerciseRound(2, cookie)];
  cleanup();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ ok: true, localOnly: true, rounds, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`今日教学闭环本地回归通过：${rounds.length} 轮；报告 ${path.relative(root, reportPath)}`);
} finally {
  try { cleanup(); } catch {}
  if (server && !server.killed) server.kill("SIGINT");
  await rm(devVars, { force: true });
}
