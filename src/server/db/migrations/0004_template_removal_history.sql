-- Earlier releases did not retain immutable template-use provenance. Preserve
-- existing templates conservatively; new unused templates remain deletable.
INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, meta_json, created_at)
SELECT lower(hex(randomblob(16))), NULL, 'template.legacy_retained', 'template', id,
  json_object('name', name, 'reason', 'Template predates reliable usage tracking'),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM checklist_templates;
