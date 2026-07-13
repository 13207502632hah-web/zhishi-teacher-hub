CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` integer NOT NULL,
	`format` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_key` text,
	`error` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `paper_questions` ADD `group_title` text;--> statement-breakpoint
ALTER TABLE `paper_questions` ADD `answer_space` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `source_document` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `parse_stage` text DEFAULT 'review' NOT NULL;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `failure_reason` text;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `review_progress` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `question_sets` ADD `duplicate_report` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `question_group` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `sub_questions` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `scoring_points` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `attachments` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `tables` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `parse_confidence` real;--> statement-breakpoint
ALTER TABLE `questions` ADD `review_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `questions` ADD `source_document_id` integer;