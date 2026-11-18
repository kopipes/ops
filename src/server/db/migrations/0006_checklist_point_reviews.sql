CREATE TABLE `check_result_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `check_result_id` text NOT NULL REFERENCES `report_check_results`(`id`),
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `verdict` text NOT NULL CHECK (`verdict` IN ('ok','not_ok')),
  `action` text CHECK (`action` IN ('re_check','re_take_photo','others')),
  `note` text,
  `content_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  CHECK ((`verdict` = 'ok' AND `action` IS NULL) OR (`verdict` = 'not_ok' AND `action` IS NOT NULL AND length(trim(coalesce(`note`,''))) > 0))
);
--> statement-breakpoint
CREATE INDEX `check_result_reviews_result_ix` ON `check_result_reviews` (`check_result_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `review_notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `recipient_id` text NOT NULL REFERENCES `users`(`id`),
  `review_id` text NOT NULL REFERENCES `check_result_reviews`(`id`),
  `read_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_notifications_recipient_review_ux` ON `review_notifications` (`recipient_id`,`review_id`);
--> statement-breakpoint
CREATE INDEX `review_notifications_inbox_ix` ON `review_notifications` (`recipient_id`,`read_at`,`created_at`);
