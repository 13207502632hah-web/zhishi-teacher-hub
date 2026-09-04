import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("V2 schedule confirmation processes bounded 50-row chunks", async () => {
  const [service, dispatch, jobs] = await Promise.all([read("app/lib/v2/schedule-import-service.ts"), read("app/lib/v2/background-dispatch.ts"), read("app/lib/v2/job-service.ts")]);
  assert.match(service, /const CONFIRM_CHUNK_SIZE = 50/);
  assert.match(service, /LIMIT \$\{CONFIRM_CHUNK_SIZE\}/);
  assert.match(service, /state: "queued", stage: "writing"/);
  assert.match(service, /checkpoint: \{ importId, processed \}/);
  assert.match(service, /return \{ requeue: true, completed, failed, remaining \}/);
  assert.match(service, /heartbeatBackgroundJob\(jobId, leaseOwner, 300\)/);
  assert.match(service, /renewScheduleLease\(jobId, leaseOwner\)/);
  assert.match(service, /state='processing' AND datetime\(updated_at\)<=datetime\('now','-300 seconds'\)/);
  assert.match(service, /claimed\.meta\?\.changes/);
  assert.match(service, /error instanceof ScheduleLeaseLostError/);
  assert.match(dispatch, /outcome\.requeue === true/);
  assert.match(dispatch, /processScheduleImportJobV2\(access, claim\.id, leaseOwner\)/);
  assert.match(dispatch, /requeueBackgroundJob\(jobId, message, leaseOwner\)/);
  assert.match(dispatch, /deferV2BackgroundJob\(jobId\)/);
  assert.match(jobs, /datetime\(COALESCE\(lease_until,'1970-01-01'\)\)>datetime\('now'\)/);
  assert.match(jobs, /ignored: true/);
});

test("V2 schedule confirmation is idempotent and recovers interrupted creates", async () => {
  const service = await read("app/lib/v2/schedule-import-service.ts");
  assert.match(service, /type='schedule-confirm' AND operation_id=\?/);
  assert.match(service, /created\.repeated/);
  assert.match(service, /state='processing' AND datetime\(updated_at\)<=datetime\('now','-300 seconds'\)/);
  assert.match(service, /row\.action === "create" && exact/);
  assert.match(service, /reconcileLessonFinance\(env\.DB, exact\.id, value\)/);
  assert.match(service, /const lessonScope/);
  assert.match(service, /c\.owner_id=\?/);
  assert.match(service, /staff_class_access sca/);
  assert.match(service, /timeConflict\(access, value/);
});

test("only versioned schedule import routes remain", async () => {
  await assert.rejects(access(new URL("../app/api/schedule-imports/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/schedule-imports/[id]/route.ts", import.meta.url)));
  await assert.rejects(access(new URL("../app/api/schedule-imports/[id]/confirm/route.ts", import.meta.url)));
  for (const path of ["app/api/v2/schedule-imports/route.ts", "app/api/v2/schedule-imports/[id]/route.ts", "app/api/v2/schedule-imports/[id]/confirm/route.ts", "app/api/v2/schedule-imports/[id]/undo/route.ts"]) assert.ok((await read(path)).length > 20);
});
