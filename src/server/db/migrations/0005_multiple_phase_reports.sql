-- Every phase can have multiple reports. Retry protection remains on client_submission_id.
DROP INDEX IF EXISTS reports_one_per_phase_ux;
--> statement-breakpoint
ALTER TABLE reports ADD COLUMN handover_note text;
--> statement-breakpoint
UPDATE reports SET handover_note = (SELECT handover_note FROM project_days WHERE project_days.id = reports.project_day_id) WHERE phase = 'closing';
