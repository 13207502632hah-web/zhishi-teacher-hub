ALTER TABLE `students` ADD `risk_tags` text;--> statement-breakpoint
ALTER TABLE `students` ADD `risk_confirmed` integer DEFAULT false NOT NULL;