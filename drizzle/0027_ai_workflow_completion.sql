CREATE TABLE `ai_feedback_drafts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` integer NOT NULL UNIQUE REFERENCES `ai_runs`(`id`),
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `lesson_id` integer NOT NULL REFERENCES `lessons`(`id`),
  `student_id` integer REFERENCES `students`(`id`),
  `sent_fields_json` text NOT NULL DEFAULT '[]',
  `draft_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `feedback_id` integer REFERENCES `feedback`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `ai_question_review_tasks` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `question_ids_json` text NOT NULL,
  `mode` text NOT NULL DEFAULT 'batch',
  `cursor` integer NOT NULL DEFAULT 0,
  `total` integer NOT NULL,
  `processed` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'queued',
  `last_error` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE `ai_runs` ADD `error_message` text;
ALTER TABLE `feedback` ADD `reflection_outline` text;
-- Keep this as a logical link rather than a reverse foreign key. The draft already
-- references feedback_id; avoiding a cyclic FK keeps account-wide deletion safe.
ALTER TABLE `feedback` ADD `ai_draft_id` integer;
ALTER TABLE `ai_question_reviews` ADD `task_id` text REFERENCES `ai_question_review_tasks`(`id`);
ALTER TABLE `ai_question_reviews` ADD `current_values_json` text NOT NULL DEFAULT '{}';
ALTER TABLE `ai_question_reviews` ADD `eligible_fields_json` text NOT NULL DEFAULT '[]';

CREATE INDEX `ai_feedback_draft_queue_index` ON `ai_feedback_drafts` (`user_id`,`status`,`created_at`);
CREATE INDEX `ai_question_review_task_queue_index` ON `ai_question_review_tasks` (`user_id`,`status`,`updated_at`);
CREATE INDEX `ai_question_review_task_index` ON `ai_question_reviews` (`task_id`,`status`);
