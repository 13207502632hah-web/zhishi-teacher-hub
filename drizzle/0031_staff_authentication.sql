CREATE TABLE IF NOT EXISTS `staff_credentials` (
  `user_id` integer PRIMARY KEY NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `password_salt` text NOT NULL,
  `password_hash` text NOT NULL,
  `iterations` integer NOT NULL DEFAULT 210000,
  `session_version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_staff_credentials_updated` ON `staff_credentials` (`updated_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff_login_attempts` (
  `key` text PRIMARY KEY NOT NULL,
  `failures` integer NOT NULL DEFAULT 0,
  `blocked_until` integer,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_staff_login_attempts_blocked` ON `staff_login_attempts` (`blocked_until`);
