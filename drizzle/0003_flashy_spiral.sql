CREATE TABLE `lesson_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`purpose` text DEFAULT '课堂练习' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_question_unique` ON `lesson_questions` (`lesson_id`,`question_id`);--> statement-breakpoint
ALTER TABLE `questions` ADD `parent_id` integer;--> statement-breakpoint
ALTER TABLE `questions` ADD `answer_points` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `is_favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `is_wrong` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `is_frequent` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `recorded_by` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `use_count` integer DEFAULT 0 NOT NULL;