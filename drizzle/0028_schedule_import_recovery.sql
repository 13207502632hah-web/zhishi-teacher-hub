ALTER TABLE `schedule_import_rows` ADD COLUMN `processing_state` text;
ALTER TABLE `schedule_import_rows` ADD COLUMN `attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `schedule_import_rows` ADD COLUMN `last_error` text;
ALTER TABLE `schedule_import_rows` ADD COLUMN `source_lineage` text;
ALTER TABLE `schedule_import_rows` ADD COLUMN `source_row_id` text;
ALTER TABLE `schedule_import_rows` ADD COLUMN `source_cell` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schedule_import_rows_lineage_index` ON `schedule_import_rows` (`source_lineage`,`source_row_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schedule_import_rows_import_state_index` ON `schedule_import_rows` (`import_id`,`processing_state`,`row_number`);
