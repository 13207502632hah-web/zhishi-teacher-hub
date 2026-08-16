CREATE TABLE IF NOT EXISTS `v2_mobile_records` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `lesson_id` integer,
  `class_id` integer,
  `student_id` integer,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `occurred_at` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `audience` text DEFAULT 'private' NOT NULL,
  `source` text DEFAULT 'web' NOT NULL,
  `version` integer DEFAULT 1 NOT NULL,
  `operation_id` text NOT NULL,
  `deleted_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`),
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_mobile_record_user_operation_unique` ON `v2_mobile_records` (`user_id`,`operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `v2_mobile_record_user_updated_index` ON `v2_mobile_records` (`user_id`,`updated_at`,`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `v2_mobile_record_shared_student_index` ON `v2_mobile_records` (`student_id`,`status`,`audience`,`updated_at`) WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `v2_mobile_record_changes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `record_id` text NOT NULL,
  `version` integer NOT NULL,
  `operation_id` text NOT NULL,
  `payload_json` text DEFAULT '{}' NOT NULL,
  `is_deleted` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`record_id`) REFERENCES `v2_mobile_records`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `v2_mobile_record_change_operation_unique` ON `v2_mobile_record_changes` (`user_id`,`operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `v2_mobile_record_change_cursor_index` ON `v2_mobile_record_changes` (`user_id`,`id`);
--> statement-breakpoint
PRAGMA optimize;
