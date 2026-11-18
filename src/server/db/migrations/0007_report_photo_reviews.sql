ALTER TABLE `photos` ADD `replaces_photo_id` text REFERENCES `photos`(`id`);
--> statement-breakpoint
CREATE INDEX `photos_replaces_ix` ON `photos` (`replaces_photo_id`);
--> statement-breakpoint
CREATE TABLE `photo_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `photo_id` text NOT NULL REFERENCES `photos`(`id`),
  `user_id` text NOT NULL REFERENCES `users`(`id`),
  `verdict` text NOT NULL CHECK (`verdict` IN ('ok','not_ok')),
  `action` text CHECK (`action` IN ('re_check','re_take_photo','others')),
  `note` text,
  `content_hash` text NOT NULL,
  `created_at` integer NOT NULL,
  CHECK ((`verdict` = 'ok' AND `action` IS NULL) OR (`verdict` = 'not_ok' AND `action` IS NOT NULL AND length(trim(coalesce(`note`,''))) > 0))
);
--> statement-breakpoint
CREATE INDEX `photo_reviews_result_ix` ON `photo_reviews` (`photo_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `photo_review_notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `recipient_id` text NOT NULL REFERENCES `users`(`id`),
  `review_id` text NOT NULL REFERENCES `photo_reviews`(`id`),
  `read_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_review_notifications_recipient_review_ux` ON `photo_review_notifications` (`recipient_id`,`review_id`);
--> statement-breakpoint
CREATE INDEX `photo_review_notifications_inbox_ix` ON `photo_review_notifications` (`recipient_id`,`read_at`,`created_at`);
