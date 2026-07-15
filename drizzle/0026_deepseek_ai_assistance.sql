CREATE TABLE `ai_settings` (
  `user_id` integer PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
  `enabled` integer NOT NULL DEFAULT 0,
  `include_student_name` integer NOT NULL DEFAULT 1,
  `privacy_ack_at` text,
  `daily_limit` integer NOT NULL DEFAULT 50,
  `emergency_disabled` integer NOT NULL DEFAULT 0,
  `fast_model` text NOT NULL DEFAULT 'deepseek-v4-flash',
  `deep_model` text NOT NULL DEFAULT 'deepseek-v4-pro',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `ai_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `feature` text NOT NULL,
  `entity_type` text,
  `entity_id` text,
  `model` text NOT NULL,
  `prompt_version` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `status` text NOT NULL DEFAULT 'running',
  `prompt_tokens` integer NOT NULL DEFAULT 0,
  `cache_hit_tokens` integer NOT NULL DEFAULT 0,
  `cache_miss_tokens` integer NOT NULL DEFAULT 0,
  `completion_tokens` integer NOT NULL DEFAULT 0,
  `total_tokens` integer NOT NULL DEFAULT 0,
  `estimated_cost_usd` real NOT NULL DEFAULT 0,
  `error_code` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `ai_feedback_learning_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `feedback_id` integer NOT NULL REFERENCES `feedback`(`id`),
  `audience` text,
  `tone` text,
  `stage` text,
  `grade` text,
  `content_template` text NOT NULL,
  `edit_summary_json` text NOT NULL DEFAULT '{}',
  `content_fingerprint` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `ai_question_reviews` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` integer NOT NULL REFERENCES `ai_runs`(`id`),
  `question_id` integer NOT NULL REFERENCES `questions`(`id`),
  `source_updated_at` text NOT NULL,
  `safe_suggestions_json` text NOT NULL DEFAULT '{}',
  `sensitive_suggestions_json` text NOT NULL DEFAULT '{}',
  `confidence_json` text NOT NULL DEFAULT '{}',
  `reasons_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'pending',
  `applied_fields_json` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX `ai_runs_user_date_index` ON `ai_runs` (`user_id`,`created_at`);
CREATE INDEX `ai_runs_feature_status_index` ON `ai_runs` (`feature`,`status`);
CREATE UNIQUE INDEX `ai_learning_user_fingerprint_unique` ON `ai_feedback_learning_events` (`user_id`,`content_fingerprint`);
CREATE INDEX `ai_learning_lookup_index` ON `ai_feedback_learning_events` (`user_id`,`active`,`audience`,`tone`);
CREATE UNIQUE INDEX `ai_question_review_source_unique` ON `ai_question_reviews` (`question_id`,`source_updated_at`);
CREATE INDEX `ai_question_review_queue_index` ON `ai_question_reviews` (`status`,`created_at`);
