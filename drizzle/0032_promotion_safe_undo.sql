ALTER TABLE `grade_promotion_runs` ADD `undo_until` text;
--> statement-breakpoint
ALTER TABLE `grade_promotion_runs` ADD `undone_by` integer REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `grade_promotion_runs` ADD `undone_at` text;
--> statement-breakpoint
ALTER TABLE `grade_promotion_runs` ADD `undo_reason` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `grade_promotion_undo_window_index` ON `grade_promotion_runs` (`status`,`undo_until`);
