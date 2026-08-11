ALTER TABLE `v2_jobs` ADD `available_at` text;
--> statement-breakpoint
ALTER TABLE `v2_jobs` ADD `attempt_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `v2_jobs` ADD `max_attempts` integer NOT NULL DEFAULT 3;
--> statement-breakpoint
ALTER TABLE `v2_jobs` ADD `lease_owner` text;
--> statement-breakpoint
ALTER TABLE `v2_jobs` ADD `lease_until` text;
--> statement-breakpoint
UPDATE `v2_jobs` SET `available_at`=COALESCE(`available_at`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `v2_jobs_background_claim_index` ON `v2_jobs` (`state`,`available_at`,`lease_until`,`created_at`);
