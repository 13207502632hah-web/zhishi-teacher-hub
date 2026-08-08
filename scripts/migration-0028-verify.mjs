#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRIZZLE_ROOT = path.join(ROOT, "drizzle");
const MIGRATION_0028 = "0028_schedule_import_recovery.sql";

async function migrationFiles(through) {
  const names = (await readdir(DRIZZLE_ROOT))
    .filter((name) => /^00\d\d_.*\.sql$/.test(name))
    .sort();
  const index = names.indexOf(through);
  assert.ok(index >= 0, `缺少迁移 ${through}`);
  return names.slice(0, index + 1);
}

async function applyMigrations(db, files) {
  db.exec("PRAGMA foreign_keys=OFF;");
  try {
    for (const file of files) {
      const content = await readFile(path.join(DRIZZLE_ROOT, file), "utf8");
      for (const block of content.split(/--> statement-breakpoint/)) {
        const sql = block.trim();
        if (sql) db.exec(sql);
      }
    }
  } finally {
    db.exec("PRAGMA foreign_keys=ON;");
  }
}

function columns(db, table) {
  return db
    .prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
    .all(table)
    .map((row) => String(row.name));
}

function hasIndex(db, indexName) {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type='index' AND name=?")
    .get(indexName);
  return Boolean(row);
}

function insertLegacyImport(db) {
  const imported = db
    .prepare(
      "INSERT INTO schedule_imports(source_name,fingerprint,status) VALUES(?,?,?) RETURNING id",
    )
    .get("legacy-课表.xlsx", "legacy-fingerprint", "preview");
  return Number(imported.id);
}

function insertLegacyRow(db, importId) {
  const inserted = db
    .prepare(
      "INSERT INTO schedule_import_rows(import_id,row_number,raw_data,normalized_data,action,issue,lesson_id) VALUES(?,?,?,?,?,?,?) RETURNING id",
    )
    .get(
      importId,
      2,
      JSON.stringify({ date: "2026-09-01" }),
      JSON.stringify({ date: "2026-09-01" }),
      "pending",
      null,
      null,
    );
  return Number(inserted.id);
}

function assertNullClaimWorks(db, rowId) {
  const claimed = db
    .prepare(
      "UPDATE schedule_import_rows SET processing_state='processing',attempts=COALESCE(attempts,0)+1,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (processing_state IS NULL OR processing_state='failed' OR processing_state='blocked' OR processing_state='needs_reconcile' OR (processing_state='processing' AND datetime(updated_at)<datetime('now','-5 minutes')))",
    )
    .run(rowId);
  assert.equal(
    Number(claimed.changes),
    1,
    "旧行 NULL processing_state 必须能被 claim",
  );
  const state = db
    .prepare("SELECT processing_state AS state, attempts FROM schedule_import_rows WHERE id=?")
    .get(rowId);
  assert.equal(state.state, "processing");
  assert.equal(Number(state.attempts), 1);
  db.prepare(
    "UPDATE schedule_import_rows SET action='created',issue=NULL,lesson_id=COALESCE(?,lesson_id),processing_state='done',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .run(null, rowId);
}

function verifyRecoverySchema(db, label) {
  const expected = [
    "id",
    "import_id",
    "row_number",
    "raw_data",
    "normalized_data",
    "action",
    "issue",
    "lesson_id",
    "processing_state",
    "attempts",
    "last_error",
    "source_lineage",
    "source_row_id",
    "source_cell",
    "created_at",
    "updated_at",
  ];
  const actual = new Set(columns(db, "schedule_import_rows"));
  assert.deepEqual(
    [...actual].sort(),
    [...new Set(expected)].sort(),
    `${label} 行表列集合不一致`,
  );
  assert.ok(hasIndex(db, "schedule_import_rows_lineage_index"), `${label} 缺 lineage 索引`);
  assert.ok(hasIndex(db, "schedule_import_rows_import_state_index"), `${label} 缺 import state 索引`);
}

async function verifyOldDatabase() {
  const files = await migrationFiles(MIGRATION_0028);
  const beforeFiles = files.filter((name) => name !== MIGRATION_0028);
  const db = new DatabaseSync(":memory:");
  try {
    await applyMigrations(db, beforeFiles);
    const importId = insertLegacyImport(db);
    const rowId = insertLegacyRow(db, importId);
    await applyMigrations(db, [MIGRATION_0028]);
    verifyRecoverySchema(db, "OLD_DB");

    const legacy = db
      .prepare("SELECT * FROM schedule_import_rows WHERE id=?")
      .get(rowId);
    assert.equal(Number(legacy.import_id), importId, "旧行 import_id 必须保留");
    assert.equal(legacy.action, "pending", "旧行 action 必须保留");
    assert.equal(legacy.processing_state, null, "旧行 processing_state 保持 NULL");
    assert.equal(Number(legacy.attempts), 0, "旧行 attempts 默认 0");
    assert.equal(legacy.source_lineage, null, "旧行 source_lineage 保持 NULL");

    assertNullClaimWorks(db, rowId);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS c FROM schedule_import_rows").get().c), 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "OLD_DB 外键完整");
    console.log("OLD_DB -> MIGRATE -> TEST PASS");
  } finally {
    db.close();
  }
}

async function verifyFreshDatabase() {
  const files = await migrationFiles(MIGRATION_0028);
  const db = new DatabaseSync(":memory:");
  try {
    await applyMigrations(db, files);
    verifyRecoverySchema(db, "FRESH_DB");
    const importId = insertLegacyImport(db);
    const rowId = insertLegacyRow(db, importId);
    assertNullClaimWorks(db, rowId);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "FRESH_DB 外键完整");
    console.log("FRESH_DB -> TEST PASS");
  } finally {
    db.close();
  }
}

async function verifySchemaSourceConsistency() {
  const migration = await readFile(path.join(DRIZZLE_ROOT, MIGRATION_0028), "utf8");
  const migrationColumns = [
    ...migration.matchAll(/ADD COLUMN `([^`]+)`/g),
  ].map((match) => match[1]);
  assert.ok(migrationColumns.length >= 6, "0028 必须新增 6 个字段");

  const schemaSource = await readFile(path.join(ROOT, "db", "schema.ts"), "utf8");
  const rowTable = schemaSource.match(/scheduleImportRows = sqliteTable\("schedule_import_rows", \{([\s\S]*?)\}\);$/m);
  assert.ok(rowTable, "db/schema.ts 缺少 scheduleImportRows 定义");
  for (const column of migrationColumns) {
    assert.ok(
      rowTable[1].includes(`"${column}"`),
      `db/schema.ts 与 0028 不一致，缺字段 ${column}`,
    );
  }
  console.log("SCHEMA_SOURCE -> 0028 CONSISTENT PASS");
}

try {
  await verifyOldDatabase();
  await verifyFreshDatabase();
  await verifySchemaSourceConsistency();
  console.log("MIGRATION VERIFY PASS");
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}
