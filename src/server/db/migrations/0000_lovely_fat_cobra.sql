CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`meta_json` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_entity_ix` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_ix` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `checklist_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`phase` text NOT NULL,
	`category_id` text NOT NULL,
	`division_id` text,
	`is_required` integer DEFAULT true NOT NULL,
	`requires_photo` integer DEFAULT false NOT NULL,
	`source_project_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `checklist_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checklist_items_phase_ix` ON `checklist_items` (`phase`);--> statement-breakpoint
CREATE INDEX `checklist_items_division_ix` ON `checklist_items` (`division_id`);--> statement-breakpoint
CREATE TABLE `checklist_template_items` (
	`template_id` text NOT NULL,
	`checklist_item_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_required_override` integer,
	`requires_photo_override` integer,
	PRIMARY KEY(`template_id`, `checklist_item_id`),
	FOREIGN KEY (`template_id`) REFERENCES `checklist_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checklist_item_id`) REFERENCES `checklist_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checklist_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`division_id` text,
	`source_project_id` text,
	`created_by` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `day_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_day_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_day_id`) REFERENCES `project_days`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `day_comments_day_ix` ON `day_comments` (`project_day_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `divisions` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`user_id` text,
	`author_name` text NOT NULL,
	`author_role` text NOT NULL,
	`author_division` text,
	`action` text NOT NULL,
	`note` text,
	`status_from` text,
	`status_to` text,
	`changes_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_updates_issue_ix` ON `issue_updates` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`project_id` text NOT NULL,
	`project_day_id` text,
	`phase` text,
	`report_id` text,
	`check_result_id` text,
	`title` text NOT NULL,
	`description` text,
	`category_id` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`next_step` text NOT NULL,
	`pic_user_id` text,
	`pic_external` text,
	`due_at` integer,
	`created_by` text,
	`author_name` text NOT NULL,
	`author_role` text NOT NULL,
	`author_division` text,
	`resolved_by` text,
	`resolved_at` integer,
	`closed_by` text,
	`closed_at` integer,
	`deleted_at` integer,
	`deleted_by` text,
	`delete_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_day_id`) REFERENCES `project_days`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`check_result_id`) REFERENCES `report_check_results`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `issue_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pic_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_code_ux` ON `issues` (`code`);--> statement-breakpoint
CREATE INDEX `issues_project_status_ix` ON `issues` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `issues_status_severity_ix` ON `issues` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `issues_creator_ix` ON `issues` (`created_by`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_day_id` text,
	`path` text NOT NULL,
	`thumb_path` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`source` text NOT NULL,
	`taken_at` integer,
	`uploaded_by` text,
	`deleted_at` integer,
	`deleted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_day_id`) REFERENCES `project_days`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_owner_ix` ON `photos` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `photos_day_ix` ON `photos` (`project_day_id`);--> statement-breakpoint
CREATE INDEX `photos_project_ix` ON `photos` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_item_id` text,
	`phase` text NOT NULL,
	`category_name` text NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`is_required` integer DEFAULT true NOT NULL,
	`requires_photo` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_item_id`) REFERENCES `checklist_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_checklist_items_project_phase_ix` ON `project_checklist_items` (`project_id`,`phase`);--> statement-breakpoint
CREATE TABLE `project_days` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`day_type` text DEFAULT 'event' NOT NULL,
	`assigned_user_id` text,
	`handover_note` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`is_out_of_range` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_days_project_date_ux` ON `project_days` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `project_days_assigned_ix` ON `project_days` (`assigned_user_id`);--> statement-breakpoint
CREATE TABLE `project_divisions` (
	`project_id` text NOT NULL,
	`division_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `division_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_divisions_division_ix` ON `project_divisions` (`division_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role_in_project` text DEFAULT 'crew' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`added_by` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_members_user_ix` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`client` text,
	`venue` text NOT NULL,
	`address` text,
	`description` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`owner_division_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`opening_window_start` text DEFAULT '06:00' NOT NULL,
	`opening_window_end` text DEFAULT '11:00' NOT NULL,
	`closing_window_start` text DEFAULT '17:00' NOT NULL,
	`closing_window_end` text DEFAULT '23:59' NOT NULL,
	`created_by` text,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_ux` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_status_ix` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `projects_owner_division_ix` ON `projects` (`owner_division_id`);--> statement-breakpoint
CREATE TABLE `report_check_results` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`project_checklist_item_id` text NOT NULL,
	`result` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_checklist_item_id`) REFERENCES `project_checklist_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_check_results_report_item_ux` ON `report_check_results` (`report_id`,`project_checklist_item_id`);--> statement-breakpoint
CREATE TABLE `report_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`edited_by` text,
	`snapshot_json` text NOT NULL,
	`changes_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `report_revisions_report_ix` ON `report_revisions` (`report_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_day_id` text NOT NULL,
	`phase` text NOT NULL,
	`submitted_by` text NOT NULL,
	`client_submission_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`observed_at` integer NOT NULL,
	`submitted_at` integer,
	`is_late` integer,
	`device_time_offset_ms` integer,
	`latitude` text,
	`longitude` text,
	`location_accuracy_m` integer,
	`deleted_at` integer,
	`deleted_by` text,
	`delete_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_day_id`) REFERENCES `project_days`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_client_submission_ux` ON `reports` (`client_submission_id`);--> statement-breakpoint
CREATE INDEX `reports_day_phase_ix` ON `reports` (`project_day_id`,`phase`);--> statement-breakpoint
CREATE INDEX `reports_submitter_ix` ON `reports` (`submitted_by`,`submitted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_one_per_phase_ux` ON `reports` (`project_day_id`,`phase`) WHERE "reports"."phase" IN ('opening','closing') AND "reports"."deleted_at" IS NULL AND "reports"."status" = 'submitted';--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_ix` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_ix` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_divisions` (
	`user_id` text NOT NULL,
	`division_id` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `division_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_divisions_division_ix` ON `user_divisions` (`division_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`primary_division_id` text,
	`must_change_password` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`primary_division_id`) REFERENCES `divisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_ux` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_ix` ON `users` (`role`);