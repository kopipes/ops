ALTER TABLE `photos` ADD `client_upload_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `photos_client_upload_ux` ON `photos` (`client_upload_id`) WHERE "photos"."client_upload_id" IS NOT NULL;