ALTER TABLE `lessons` ADD COLUMN `knowledge_points` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_workflow_state` (
  `lesson_id` integer PRIMARY KEY NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `draft_payload` text DEFAULT '{}' NOT NULL,
  `homework_paper_id` integer,
  `homework_assignment_id` integer,
  `updated_by` integer,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`),
  FOREIGN KEY (`homework_paper_id`) REFERENCES `papers`(`id`),
  FOREIGN KEY (`homework_assignment_id`) REFERENCES `assignments`(`id`),
  FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `lesson_completion_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `lesson_id` integer NOT NULL,
  `actor_id` integer NOT NULL,
  `before_snapshot` text NOT NULL,
  `artifact_snapshot` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `completed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `undone_at` text,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`),
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workflow_templates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` integer NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `payload_json` text DEFAULT '{}' NOT NULL,
  `is_default` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `workflow_template_owner_type_name_unique` ON `workflow_templates` (`owner_id`,`type`,`name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `lesson_workflow_updated_index` ON `lesson_workflow_state` (`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `lesson_completion_latest_index` ON `lesson_completion_runs` (`lesson_id`,`completed_at`,`status`);
