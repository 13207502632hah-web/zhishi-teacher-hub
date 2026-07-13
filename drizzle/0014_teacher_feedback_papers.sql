ALTER TABLE `assignments` ADD `paper_id` integer;--> statement-breakpoint
ALTER TABLE `papers` ADD `year` integer;--> statement-breakpoint
ALTER TABLE `papers` ADD `region` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `school` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `source` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `use_status` text DEFAULT 'unused' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `parse_status` text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
CREATE TABLE `paper_files` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `paper_id` integer NOT NULL,
  `version_type` text DEFAULT 'student' NOT NULL,
  `original_name` text NOT NULL,
  `storage_key` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `fingerprint` text NOT NULL,
  `page_count` integer,
  `parse_status` text DEFAULT 'queued' NOT NULL,
  `parse_message` text,
  `uploaded_by` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`),
  FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
);--> statement-breakpoint
ALTER TABLE `feedback` ADD `audience` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `length_mode` text DEFAULT 'short' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `custom_input` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `previous_homework` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `class_performance` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `weak_points` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `due_at` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `short_content` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `standard_content` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `copied_at` text;--> statement-breakpoint
CREATE TABLE `feedback_templates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `audience` text DEFAULT 'private' NOT NULL,
  `tone` text DEFAULT '温和鼓励' NOT NULL,
  `opening` text,
  `closing` text,
  `style_rules` text,
  `example_text` text,
  `is_default` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
