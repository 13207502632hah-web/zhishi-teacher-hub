CREATE TABLE IF NOT EXISTS `v2_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `type` text NOT NULL,
  `entity_type` text,
  `entity_id` text,
  `state` text NOT NULL DEFAULT 'queued',
  `stage` text NOT NULL DEFAULT 'queued',
  `progress` integer NOT NULL DEFAULT 0,
  `processed` integer NOT NULL DEFAULT 0,
  `total` integer NOT NULL DEFAULT 0,
  `payload_json` text NOT NULL DEFAULT '{}',
  `result_json` text NOT NULL DEFAULT '{}',
  `checkpoint_json` text NOT NULL DEFAULT '{}',
  `error_json` text NOT NULL DEFAULT '{}',
  `operation_id` text NOT NULL,
  `cancel_requested` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_job_operation_unique` ON `v2_jobs` (`user_id`,`type`,`operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_jobs_user_state_updated` ON `v2_jobs` (`user_id`,`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_job_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `job_id` text NOT NULL REFERENCES `v2_jobs`(`id`),
  `state` text NOT NULL,
  `stage` text NOT NULL,
  `progress` integer NOT NULL DEFAULT 0,
  `message` text,
  `detail_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_job_events_job_id` ON `v2_job_events` (`job_id`,`id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `job_id` text REFERENCES `v2_jobs`(`id`),
  `action_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text,
  `title` text NOT NULL,
  `summary` text NOT NULL,
  `payload_json` text NOT NULL DEFAULT '{}',
  `evidence_json` text NOT NULL DEFAULT '[]',
  `confidence` real,
  `state` text NOT NULL DEFAULT 'pending',
  `decision_note` text,
  `decided_by` integer REFERENCES `users`(`id`),
  `decided_at` text,
  `expires_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_approvals_user_state_created` ON `v2_approvals` (`user_id`,`state`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_idempotency_operations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `action` text NOT NULL,
  `operation_id` text NOT NULL,
  `request_fingerprint` text,
  `state` text NOT NULL DEFAULT 'running',
  `result_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_idempotency_actor_action_unique` ON `v2_idempotency_operations` (`user_id`,`action`,`operation_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_ai_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `job_id` text REFERENCES `v2_jobs`(`id`),
  `capability` text NOT NULL,
  `provider` text NOT NULL,
  `model` text NOT NULL,
  `prompt_version` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `input_summary` text,
  `confidence` real,
  `evidence_json` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL DEFAULT 'running',
  `prompt_tokens` integer NOT NULL DEFAULT 0,
  `completion_tokens` integer NOT NULL DEFAULT 0,
  `total_tokens` integer NOT NULL DEFAULT 0,
  `error_code` text,
  `error_message` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_ai_runs_user_created` ON `v2_ai_runs` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_schedule_imports` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `job_id` text NOT NULL REFERENCES `v2_jobs`(`id`),
  `source_name` text NOT NULL,
  `source_type` text NOT NULL,
  `storage_key` text NOT NULL,
  `fingerprint` text NOT NULL,
  `format` text NOT NULL DEFAULT 'unknown',
  `mapping_json` text NOT NULL DEFAULT '{}',
  `report_json` text NOT NULL DEFAULT '{}',
  `state` text NOT NULL DEFAULT 'queued',
  `operation_id` text NOT NULL,
  `confirmed_at` text,
  `undo_until` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_schedule_import_fingerprint_unique` ON `v2_schedule_imports` (`user_id`,`fingerprint`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_schedule_imports_user_state` ON `v2_schedule_imports` (`user_id`,`state`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_schedule_rows` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `import_id` text NOT NULL REFERENCES `v2_schedule_imports`(`id`),
  `row_number` integer NOT NULL,
  `source_cell` text,
  `raw_json` text NOT NULL DEFAULT '{}',
  `normalized_json` text NOT NULL DEFAULT '{}',
  `previous_json` text NOT NULL DEFAULT '{}',
  `state` text NOT NULL DEFAULT 'valid',
  `confidence` real NOT NULL DEFAULT 1,
  `issues_json` text NOT NULL DEFAULT '[]',
  `action` text NOT NULL DEFAULT 'create',
  `lesson_id` integer REFERENCES `lessons`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_schedule_import_row_unique` ON `v2_schedule_rows` (`import_id`,`row_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_schedule_rows_import_state` ON `v2_schedule_rows` (`import_id`,`state`,`id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_question_vectors` (
  `question_id` integer PRIMARY KEY NOT NULL REFERENCES `questions`(`id`),
  `model` text NOT NULL,
  `dimensions` integer NOT NULL,
  `vector_json` text NOT NULL,
  `text_fingerprint` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_search_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `query` text NOT NULL,
  `mode` text NOT NULL,
  `filters_json` text NOT NULL DEFAULT '{}',
  `result_ids_json` text NOT NULL DEFAULT '[]',
  `coverage_json` text NOT NULL DEFAULT '{}',
  `latency_ms` integer NOT NULL DEFAULT 0,
  `feedback` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_v2_search_events_user_created` ON `v2_search_events` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `v2_questions_fts` USING fts5(
  `stem`, `material`, `analysis`, `knowledge_points`, `tags`, `source`,
  content='questions', content_rowid='id', tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `v2_questions_fts_insert` AFTER INSERT ON `questions` BEGIN
  INSERT INTO `v2_questions_fts`(rowid,stem,material,analysis,knowledge_points,tags,source) VALUES(new.id,new.stem,new.material,new.analysis,new.knowledge_points,new.tags,new.source);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `v2_questions_fts_delete` AFTER DELETE ON `questions` BEGIN
  INSERT INTO `v2_questions_fts`(`v2_questions_fts`,rowid,stem,material,analysis,knowledge_points,tags,source) VALUES('delete',old.id,old.stem,old.material,old.analysis,old.knowledge_points,old.tags,old.source);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `v2_questions_fts_update` AFTER UPDATE ON `questions` BEGIN
  INSERT INTO `v2_questions_fts`(`v2_questions_fts`,rowid,stem,material,analysis,knowledge_points,tags,source) VALUES('delete',old.id,old.stem,old.material,old.analysis,old.knowledge_points,old.tags,old.source);
  INSERT INTO `v2_questions_fts`(rowid,stem,material,analysis,knowledge_points,tags,source) VALUES(new.id,new.stem,new.material,new.analysis,new.knowledge_points,new.tags,new.source);
END;
--> statement-breakpoint
INSERT INTO `v2_questions_fts`(`v2_questions_fts`) VALUES('rebuild');
--> statement-breakpoint
PRAGMA optimize;
