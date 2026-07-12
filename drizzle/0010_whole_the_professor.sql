CREATE TABLE `teacher_admin_credentials` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`iterations` integer DEFAULT 210000 NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teacher_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
