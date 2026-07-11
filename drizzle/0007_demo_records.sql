CREATE TABLE `demo_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `demo_records_run_index` ON `demo_records` (`run_id`);
