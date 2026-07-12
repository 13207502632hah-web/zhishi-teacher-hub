CREATE TABLE `demo_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staff_class_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_class_access_unique` ON `staff_class_access` (`user_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `teacher_admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`iterations` integer DEFAULT 210000 NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teacher_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wrong_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`lesson_id` integer,
	`incorrect_answer` text,
	`reason` text,
	`status` text DEFAULT 'active' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`mastered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wrong_question_student_question_lesson_unique` ON `wrong_questions` (`student_id`,`question_id`,`lesson_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wrong_question_student_status_index` ON `wrong_questions` (`student_id`,`status`);--> statement-breakpoint
ALTER TABLE `classes` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `classes` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `sent_at` text;--> statement-breakpoint
ALTER TABLE `lessons` ADD `fee` real;--> statement-breakpoint
ALTER TABLE `lessons` ADD `fee_status` text DEFAULT 'untracked' NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `grade` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `textbook_version` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `duration_minutes` integer;--> statement-breakpoint
ALTER TABLE `papers` ADD `instructions` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `import_report` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `secondary_knowledge` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `ability_level` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `source_file` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `exam_type` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `reviewed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `school` text;--> statement-breakpoint
ALTER TABLE `students` ADD `textbook_version` text;--> statement-breakpoint
ALTER TABLE `students` ADD `subject_choice` text;--> statement-breakpoint
ALTER TABLE `students` ADD `exam_goal` text;--> statement-breakpoint
ALTER TABLE `students` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `archived_at` text;