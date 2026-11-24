CREATE TABLE division_checklist_templates (
  id TEXT PRIMARY KEY NOT NULL,
  division_id TEXT NOT NULL REFERENCES divisions(id),
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT REFERENCES users(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX division_checklist_templates_division_ix ON division_checklist_templates(division_id, is_active);
--> statement-breakpoint
CREATE TABLE division_checklist_template_items (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES division_checklist_templates(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('opening', 'monitoring', 'closing')),
  category_name TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  is_required INTEGER NOT NULL DEFAULT 1,
  requires_photo INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX division_checklist_template_items_order_ix ON division_checklist_template_items(template_id, sort_order);
--> statement-breakpoint
INSERT INTO division_checklist_templates (id, division_id, name, description, created_by, is_active, created_at, updated_at)
SELECT t.id, t.division_id, t.name, t.description, t.created_by, t.is_active, t.created_at, t.updated_at
FROM checklist_templates t WHERE t.division_id IS NOT NULL;
--> statement-breakpoint
WITH global_targets AS (
  SELECT t.id AS template_id, p.owner_division_id AS division_id
  FROM checklist_templates t
  JOIN projects p ON p.id = t.source_project_id
  WHERE t.division_id IS NULL AND p.deleted_at IS NULL
  UNION
  SELECT t.id, p.owner_division_id
  FROM checklist_templates t
  JOIN audit_logs a ON a.entity_id = t.id AND a.entity_type = 'template' AND a.action = 'template.used'
  JOIN projects p ON p.id = CASE WHEN json_valid(a.meta_json) THEN json_extract(a.meta_json, '$.projectId') END
  WHERE t.division_id IS NULL AND p.deleted_at IS NULL
)
INSERT INTO division_checklist_templates (id, division_id, name, description, created_by, is_active, created_at, updated_at)
SELECT 'legacy:' || t.id || ':' || g.division_id, g.division_id, t.name, t.description, t.created_by,
       t.is_active, t.created_at, t.updated_at
FROM global_targets g JOIN checklist_templates t ON t.id = g.template_id;
--> statement-breakpoint
INSERT INTO division_checklist_template_items
  (id, template_id, phase, category_name, label, description, is_required, requires_photo, sort_order)
SELECT lower(hex(randomblob(16))), dest.id, i.phase, c.name, i.label, i.description,
       coalesce(j.is_required_override, i.is_required), coalesce(j.requires_photo_override, i.requires_photo),
       row_number() OVER (PARTITION BY dest.id ORDER BY j.sort_order, i.sort_order, i.id) - 1
FROM division_checklist_templates dest
JOIN checklist_templates t ON dest.id = t.id OR (t.division_id IS NULL AND dest.id = 'legacy:' || t.id || ':' || dest.division_id)
JOIN checklist_template_items j ON j.template_id = t.id
JOIN checklist_items i ON i.id = j.checklist_item_id
JOIN checklist_categories c ON c.id = i.category_id;
