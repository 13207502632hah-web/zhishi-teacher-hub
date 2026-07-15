CREATE TABLE IF NOT EXISTS `saved_question_views` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` integer NOT NULL,
  `name` text NOT NULL,
  `filters_json` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `saved_question_view_owner_name_unique` ON `saved_question_views` (`owner_id`,`name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `saved_question_view_owner_updated_index` ON `saved_question_views` (`owner_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `question_search_textbook_index` ON `questions` (`status`,`stage`,`grade`,`textbook_version`,`volume`,`unit`,`topic`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `question_search_knowledge_index` ON `questions` (`status`,`knowledge_points`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `question_search_sort_index` ON `questions` (`status`,`updated_at`,`difficulty`,`use_count`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `question_search_auxiliary_index` ON `questions` (`status`,`year`,`region`,`exam_type`,`question_type`);
