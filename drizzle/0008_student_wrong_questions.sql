CREATE TABLE `wrong_questions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `student_id` integer NOT NULL,
  `question_id` integer NOT NULL,
  `lesson_id` integer,
  `incorrect_answer` text,
  `reason` text,
  `status` text DEFAULT 'active' NOT NULL,
  `occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `mastered_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `wrong_question_student_question_lesson_unique` ON `wrong_questions` (`student_id`,`question_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `wrong_question_student_status_index` ON `wrong_questions` (`student_id`,`status`);
