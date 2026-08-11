CREATE TABLE IF NOT EXISTS `class_files` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `class_id` integer NOT NULL REFERENCES `classes`(`id`),
  `asset_id` integer NOT NULL UNIQUE REFERENCES `file_assets`(`id`),
  `title` text NOT NULL,
  `description` text,
  `category` text NOT NULL DEFAULT '学习资料',
  `status` text NOT NULL DEFAULT 'draft',
  `operation_id` text NOT NULL,
  `published_at` text,
  `published_by` integer REFERENCES `users`(`id`),
  `archived_at` text,
  `created_by` integer NOT NULL REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `class_files_creator_operation_unique` ON `class_files` (`created_by`,`operation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `class_files_class_status_updated_idx` ON `class_files` (`class_id`,`status`,`updated_at` DESC);
