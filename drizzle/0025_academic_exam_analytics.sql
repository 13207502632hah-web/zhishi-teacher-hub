CREATE TABLE `academic_years` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL UNIQUE,
  `start_date` text NOT NULL,
  `end_date` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `exam_projects` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `academic_year` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `stage` text NOT NULL,
  `grade` text NOT NULL,
  `exam_date` text,
  `total_score` real NOT NULL DEFAULT 100,
  `paper_id` integer REFERENCES `papers`(`id`),
  `status` text NOT NULL DEFAULT 'draft',
  `notes` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `exam_project_students` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `exam_projects`(`id`),
  `student_id` integer NOT NULL REFERENCES `students`(`id`),
  `assessment_result_id` integer REFERENCES `assessment_results`(`id`),
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE `assessments` ADD `exam_project_id` integer REFERENCES `exam_projects`(`id`);

CREATE TABLE `grade_promotion_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `academic_year` text NOT NULL UNIQUE,
  `status` text NOT NULL DEFAULT 'preview',
  `confirmed_by` integer REFERENCES `users`(`id`),
  `confirmed_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `grade_promotion_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` integer NOT NULL REFERENCES `grade_promotion_runs`(`id`),
  `student_id` integer NOT NULL REFERENCES `students`(`id`),
  `from_grade` text NOT NULL,
  `to_grade` text,
  `action` text NOT NULL DEFAULT 'promote',
  `status` text NOT NULL DEFAULT 'pending',
  `reason` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `review_assets` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `review_id` integer NOT NULL REFERENCES `submission_reviews`(`id`),
  `asset_id` integer NOT NULL REFERENCES `file_assets`(`id`),
  `type` text NOT NULL,
  `position` integer NOT NULL DEFAULT 0,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX `exam_project_identity_unique` ON `exam_projects` (`academic_year`,`category`,`stage`,`grade`);
CREATE UNIQUE INDEX `exam_project_student_unique` ON `exam_project_students` (`project_id`,`student_id`);
CREATE INDEX `exam_project_filter_index` ON `exam_projects` (`academic_year`,`stage`,`grade`,`category`);
CREATE INDEX `exam_project_result_index` ON `exam_project_students` (`student_id`,`project_id`,`status`);
CREATE UNIQUE INDEX `grade_promotion_student_unique` ON `grade_promotion_items` (`run_id`,`student_id`);
CREATE INDEX `assessment_project_index` ON `assessments` (`exam_project_id`,`date`);
CREATE INDEX `assessment_question_student_index` ON `assessment_question_results` (`assessment_result_id`,`question_number`);
