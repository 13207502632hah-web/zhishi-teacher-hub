CREATE TABLE IF NOT EXISTS `class_notices` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `class_id` integer NOT NULL REFERENCES `classes`(`id`),
  `title` text NOT NULL,
  `content` text NOT NULL,
  `audience_role` text NOT NULL DEFAULT 'both',
  `status` text NOT NULL DEFAULT 'draft',
  `operation_id` text NOT NULL,
  `published_at` text,
  `published_by` integer REFERENCES `users`(`id`),
  `archived_at` text,
  `created_by` integer NOT NULL REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `class_notices_creator_operation_unique` ON `class_notices` (`created_by`,`operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `class_notices_class_status_updated_idx` ON `class_notices` (`class_id`,`status`,`updated_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notice_receipts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `notice_id` integer NOT NULL REFERENCES `class_notices`(`id`),
  `account_id` integer NOT NULL REFERENCES `wechat_accounts`(`id`),
  `student_id` integer NOT NULL REFERENCES `students`(`id`),
  `role` text NOT NULL,
  `operation_id` text NOT NULL,
  `read_at` text,
  `acknowledged_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notice_receipts_notice_account_student_unique` ON `notice_receipts` (`notice_id`,`account_id`,`student_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notice_receipts_notice_state_idx` ON `notice_receipts` (`notice_id`,`read_at`,`acknowledged_at`);
