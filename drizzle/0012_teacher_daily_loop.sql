ALTER TABLE `assessment_results` ADD `objective_score` real;--> statement-breakpoint
ALTER TABLE `assessment_results` ADD `subjective_score` real;--> statement-breakpoint
ALTER TABLE `assessment_results` ADD `weak_knowledge` text;--> statement-breakpoint
ALTER TABLE `assessment_results` ADD `teacher_note` text;--> statement-breakpoint
DELETE FROM `assessment_results` WHERE `id` NOT IN (SELECT MAX(`id`) FROM `assessment_results` GROUP BY `assessment_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_student_unique` ON `assessment_results` (`assessment_id`,`student_id`);--> statement-breakpoint
ALTER TABLE `assessments` ADD `total_score` real DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `type` text DEFAULT '课堂测验' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `assessments` ADD `notes` text;
