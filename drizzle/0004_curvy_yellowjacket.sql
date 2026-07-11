ALTER TABLE `feedback` ADD `learning_content` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `highlights` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `consolidate` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `homework_requirements` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `parent_advice` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `next_focus` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `period_start` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `period_end` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `period_summary` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `progress` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `problems` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `goals` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `suggestions` text;--> statement-breakpoint
ALTER TABLE `reflections` ADD `problem_type` text;--> statement-breakpoint
ALTER TABLE `reflections` ADD `action_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `resources` ADD `content` text;--> statement-breakpoint
ALTER TABLE `resources` ADD `source_ref` text;