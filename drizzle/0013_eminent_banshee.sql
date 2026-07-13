-- The first production attempt applied export_jobs, paper_questions.group_title,
-- paper_questions.answer_space and question_sets.source_document before the
-- deployment worker retried the migration. Keep the remaining statements here
-- so the partially applied production migration can finish safely. Fresh
-- databases receive those four fields from migration 0000.
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
