-- Generated weekly-schedule delta only. Existing 0021–0037 migrations already own the other generated differences.
CREATE TABLE `lesson_series` (
 `id` text PRIMARY KEY NOT NULL,
 `user_id` integer NOT NULL REFERENCES `users`(`id`),
 `name` text NOT NULL,
 `start_date` text NOT NULL,
 `end_date` text NOT NULL,
 `weekday` integer NOT NULL,
 `rule_json` text NOT NULL,
 `version` integer DEFAULT 1 NOT NULL,
 `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lesson_occurrences` (
 `lesson_id` integer PRIMARY KEY NOT NULL REFERENCES `lessons`(`id`) ON DELETE cascade,
 `series_id` text NOT NULL REFERENCES `lesson_series`(`id`),
 `original_date` text NOT NULL,
 `scheduled_date` text NOT NULL,
 `is_exception` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_occurrence_unique` ON `lesson_occurrences` (`series_id`,`original_date`);
--> statement-breakpoint
CREATE TABLE `lesson_series_operations` (
 `id` text PRIMARY KEY NOT NULL,
 `user_id` integer NOT NULL REFERENCES `users`(`id`),
 `request_json` text NOT NULL,
 `result_json` text NOT NULL,
 `validated` integer NOT NULL,
 `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 CONSTRAINT "lesson_series_operation_validated" CHECK("lesson_series_operations"."validated" = 1)
);
