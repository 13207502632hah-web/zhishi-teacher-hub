ALTER TABLE `question_sets` ADD `paper_id` integer REFERENCES `papers`(`id`);

ALTER TABLE `papers` ADD `academic_year` text;
ALTER TABLE `papers` ADD `exam_category` text;
ALTER TABLE `papers` ADD `semester` text;
ALTER TABLE `papers` ADD `province` text;
ALTER TABLE `papers` ADD `city` text;
ALTER TABLE `papers` ADD `district` text;
ALTER TABLE `papers` ADD `exam_date` text;

CREATE TABLE `feedback_imports` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_asset_id` integer REFERENCES `file_assets`(`id`),
  `source_text` text,
  `ocr_text` text,
  `parsed_payload` text NOT NULL DEFAULT '{}',
  `confidence` real NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'draft',
  `matched_lesson_id` integer REFERENCES `lessons`(`id`),
  `confirmed_lesson_id` integer REFERENCES `lessons`(`id`),
  `created_by` integer REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` text
);

CREATE INDEX `question_sets_paper_index` ON `question_sets` (`paper_id`,`status`);
CREATE INDEX `papers_archive_filter_index` ON `papers` (`academic_year`,`exam_category`,`stage`,`grade`,`province`,`city`,`district`);
CREATE INDEX `feedback_import_status_index` ON `feedback_imports` (`status`,`created_at`);
