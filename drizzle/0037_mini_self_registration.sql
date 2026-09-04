CREATE TABLE IF NOT EXISTS `mini_registration_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL REFERENCES `wechat_accounts`(`id`),
  `role` text NOT NULL,
  `applicant_name` text NOT NULL,
  `student_name` text NOT NULL,
  `class_or_grade` text NOT NULL,
  `relationship` text,
  `status` text NOT NULL DEFAULT 'pending',
  `student_id` integer REFERENCES `students`(`id`),
  `decided_by` integer REFERENCES `users`(`id`),
  `decided_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mini_registration_pending_unique`
  ON `mini_registration_requests` (`account_id`,`role`,`student_name`)
  WHERE `status`='pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mini_registration_status_updated_index`
  ON `mini_registration_requests` (`status`,`updated_at` DESC);
--> statement-breakpoint
PRAGMA optimize;
