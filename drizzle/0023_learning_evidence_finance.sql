CREATE TABLE IF NOT EXISTS `feedback_evidence` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `feedback_id` integer NOT NULL,
  `source_type` text NOT NULL,
  `source_id` integer,
  `label` text NOT NULL,
  `excerpt` text,
  `source_date` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`id`)
);
--> statement-breakpoint
ALTER TABLE `lesson_finance` ADD COLUMN `pricing_rule_id` integer REFERENCES `pricing_rules`(`id`);
--> statement-breakpoint
ALTER TABLE `lesson_finance` ADD COLUMN `calculation_snapshot` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_evidence_feedback_index` ON `feedback_evidence` (`feedback_id`,`source_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `lessons_date_status_index` ON `lessons` (`date`,`status`,`start_time`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assignment_lesson_status_index` ON `assignments` (`lesson_id`,`status`,`due_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submission_student_status_index` ON `assignment_submissions` (`student_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `student_lesson_record_student_updated_index` ON `student_lesson_records` (`student_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `feedback_student_status_index` ON `feedback` (`student_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `lesson_finance_status_updated_index` ON `lesson_finance` (`status`,`updated_at`);
