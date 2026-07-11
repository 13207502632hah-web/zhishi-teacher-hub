ALTER TABLE `resources` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `students` ADD `user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `students` ADD `guardian_user_id` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `users` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);