DROP INDEX projects_code_ux;
--> statement-breakpoint
CREATE UNIQUE INDEX projects_code_ux ON projects (code) WHERE deleted_at IS NULL AND code <> '';
