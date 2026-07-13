CREATE TABLE IF NOT EXISTS `mini_bindings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL,
  `student_id` integer NOT NULL,
  `role` text NOT NULL,
  `invite_id` integer,
  `status` text DEFAULT 'pending' NOT NULL,
  `confirmed_by` integer,
  `confirmed_at` text,
  `disabled_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `wechat_accounts`(`id`),
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  FOREIGN KEY (`invite_id`) REFERENCES `mini_invites`(`id`),
  FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mini_binding_account_student_role_unique` ON `mini_bindings` (`account_id`,`student_id`,`role`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mini_binding_status_index` ON `mini_bindings` (`status`,`student_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assignment_targets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `assignment_id` integer NOT NULL,
  `target_type` text NOT NULL,
  `target_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `assignment_target_unique` ON `assignment_targets` (`assignment_id`,`target_type`,`target_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assignment_settings` (
  `assignment_id` integer PRIMARY KEY NOT NULL,
  `allow_parent_submit` integer DEFAULT true NOT NULL,
  `require_revision` integer DEFAULT true NOT NULL,
  `published_at` text,
  `closed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_operations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_type` text NOT NULL,
  `actor_id` integer NOT NULL,
  `action` text NOT NULL,
  `operation_id` text NOT NULL,
  `status` text DEFAULT 'started' NOT NULL,
  `result_json` text,
  `expires_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idempotency_actor_action_operation_unique` ON `idempotency_operations` (`actor_type`,`actor_id`,`action`,`operation_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `audience_role` text,
  `student_id` integer,
  `account_id` integer,
  `payload` text,
  `is_deleted` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`),
  FOREIGN KEY (`account_id`) REFERENCES `wechat_accounts`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_events_cursor_index` ON `sync_events` (`id`,`audience_role`,`student_id`,`account_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `file_leases` (
  `asset_id` integer PRIMARY KEY NOT NULL,
  `operation_id` text,
  `state` text DEFAULT 'temporary' NOT NULL,
  `linked_entity_type` text,
  `linked_entity_id` text,
  `expires_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`asset_id`) REFERENCES `file_assets`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `submission_reviews` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `submission_id` integer NOT NULL,
  `submission_version_id` integer,
  `status` text DEFAULT 'draft' NOT NULL,
  `outcome` text,
  `score` real,
  `review_tags` text,
  `teacher_note` text,
  `revision_requirements` text,
  `operation_id` text,
  `reviewed_by` integer,
  `confirmed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions`(`id`),
  FOREIGN KEY (`submission_version_id`) REFERENCES `submission_versions`(`id`),
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submission_review_submission_status_index` ON `submission_reviews` (`submission_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reminder_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `account_id` integer,
  `student_id` integer,
  `operation_id` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `failure_reason` text,
  `scheduled_at` text,
  `sent_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reminder_task_operation_unique` ON `reminder_tasks` (`operation_id`);
