CREATE TABLE IF NOT EXISTS `assessment_question_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_result_id` integer NOT NULL,
	`question_id` integer,
	`question_number` text NOT NULL,
	`answer` text,
	`score` real,
	`max_score` real,
	`knowledge_points` text,
	`error_type` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`confirmed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assessment_result_id`) REFERENCES `assessment_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `assessment_result_question_unique` ON `assessment_question_results` (`assessment_result_id`,`question_number`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assignment_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `calendar_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`label` text DEFAULT 'Apple 日历' NOT NULL,
	`reminder_minutes` integer DEFAULT 30 NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `calendar_subscriptions_token_hash_unique` ON `calendar_subscriptions` (`token_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `excellent_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_version_id` integer NOT NULL,
	`masked_asset_id` integer,
	`masking_status` text DEFAULT 'pending' NOT NULL,
	`published_at` text,
	`published_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_version_id`) REFERENCES `submission_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`masked_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `excellent_submissions_submission_version_id_unique` ON `excellent_submissions` (`submission_version_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `file_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`fingerprint` text,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `file_assets_storage_key_unique` ON `file_assets` (`storage_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `institutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`settlement_cycle` text DEFAULT 'monthly' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_evidence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`textbook_node_id` integer,
	`knowledge_name` text NOT NULL,
	`level` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer,
	`evidence` text NOT NULL,
	`is_manual` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`textbook_node_id`) REFERENCES `textbook_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_billing_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_finance_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`attendance_status` text DEFAULT 'present' NOT NULL,
	`billing_factor` real DEFAULT 1 NOT NULL,
	`unit_fee` real DEFAULT 0 NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lesson_finance_id`) REFERENCES `lesson_finance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `lesson_billing_student_unique` ON `lesson_billing_items` (`lesson_finance_id`,`student_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_finance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`payer_type` text NOT NULL,
	`payer_id` integer,
	`base_fee` real DEFAULT 0 NOT NULL,
	`adjustment` real DEFAULT 0 NOT NULL,
	`expected_amount` real DEFAULT 0 NOT NULL,
	`received_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`confirmed_at` text,
	`confirmed_by` integer,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `lesson_finance_lesson_id_unique` ON `lesson_finance` (`lesson_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_packages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`name` text NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`purchased_hours` real DEFAULT 0 NOT NULL,
	`balance_hours` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mini_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `wechat_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mini_sessions_token_hash_unique` ON `mini_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mini_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_hash` text NOT NULL,
	`role` text NOT NULL,
	`student_id` integer,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mini_invites_code_hash_unique` ON `mini_invites` (`code_hash`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `package_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`package_id` integer NOT NULL,
	`lesson_id` integer,
	`type` text NOT NULL,
	`hours_delta` real DEFAULT 0 NOT NULL,
	`amount_delta` real DEFAULT 0 NOT NULL,
	`reason` text NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`package_id`) REFERENCES `lesson_packages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `parent_student_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_account_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmed_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parent_account_id`) REFERENCES `wechat_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `parent_student_link_unique` ON `parent_student_links` (`parent_account_id`,`student_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`institution_id` integer,
	`student_id` integer,
	`payer_type` text NOT NULL,
	`base_fee` real DEFAULT 0 NOT NULL,
	`per_student_fee` real DEFAULT 0 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`institution_id`) REFERENCES `institutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recognition_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`question_id` integer,
	`question_number` text NOT NULL,
	`student_answer` text,
	`standard_answer` text,
	`recognized_score` real,
	`teacher_score` real,
	`max_score` real,
	`confidence` real,
	`candidates` text,
	`crop_asset_id` integer,
	`knowledge_points` text,
	`error_type` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `recognition_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`crop_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recognition_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assessment_id` integer,
	`student_id` integer,
	`source_asset_id` integer NOT NULL,
	`answer_asset_id` integer,
	`provider` text DEFAULT 'manual' NOT NULL,
	`stage` text DEFAULT 'uploaded' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error` text,
	`confirmed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answer_asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_version_id` integer NOT NULL,
	`asset_id` integer,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_version_id`) REFERENCES `submission_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_import_rows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`row_number` integer NOT NULL,
	`raw_data` text NOT NULL,
	`normalized_data` text,
	`action` text DEFAULT 'pending' NOT NULL,
	`issue` text,
	`lesson_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `schedule_imports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_name` text NOT NULL,
	`fingerprint` text NOT NULL,
	`mapping` text,
	`report` text,
	`status` text DEFAULT 'preview' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settlement_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_id` integer NOT NULL,
	`lesson_finance_id` integer NOT NULL,
	`expected_amount` real NOT NULL,
	`received_amount` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_finance_id`) REFERENCES `lesson_finance`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `settlement_finance_unique` ON `settlement_items` (`settlement_id`,`lesson_finance_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payer_type` text NOT NULL,
	`payer_id` integer,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`expected_amount` real DEFAULT 0 NOT NULL,
	`received_amount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confirmed_at` text,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `submission_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_version_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`precheck_status` text DEFAULT 'pending' NOT NULL,
	`precheck_notes` text,
	FOREIGN KEY (`submission_version_id`) REFERENCES `submission_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `file_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `submission_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`version` integer NOT NULL,
	`text_content` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_by_role` text NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `submission_version_unique` ON `submission_versions` (`submission_id`,`version`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `textbook_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`stage` text NOT NULL,
	`grade` text,
	`textbook_version` text,
	`level` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `wechat_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`student_id` integer,
	`open_id` text,
	`role` text NOT NULL,
	`display_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `wechat_accounts_open_id_unique` ON `wechat_accounts` (`open_id`);--> statement-breakpoint
