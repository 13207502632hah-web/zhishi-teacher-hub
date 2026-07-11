ALTER TABLE `classes` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `students` ADD `school` text;--> statement-breakpoint
ALTER TABLE `students` ADD `textbook_version` text;--> statement-breakpoint
ALTER TABLE `students` ADD `subject_choice` text;--> statement-breakpoint
ALTER TABLE `students` ADD `exam_goal` text;--> statement-breakpoint
ALTER TABLE `students` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `fee` real;--> statement-breakpoint
ALTER TABLE `lessons` ADD `fee_status` text DEFAULT 'untracked' NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `import_report` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `secondary_knowledge` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `ability_level` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `source_file` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `exam_type` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `grade` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `textbook_version` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `duration_minutes` integer;--> statement-breakpoint
ALTER TABLE `papers` ADD `instructions` text;--> statement-breakpoint
CREATE TABLE `staff_class_access` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `class_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_class_access_unique` ON `staff_class_access` (`user_id`,`class_id`);--> statement-breakpoint
CREATE INDEX `questions_fingerprint_index` ON `questions` (`fingerprint`);
