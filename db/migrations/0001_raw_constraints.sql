-- RAW_SQL from db/schema.ts (constraints Drizzle cannot express). Keep identical: db/migrations.db.test.ts checks it.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- FR-P3: a class is in one room at a time, and a room holds one class at a time.
ALTER TABLE class_room_links ADD CONSTRAINT class_room_links_class_no_overlap
  EXCLUDE USING gist (class_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
ALTER TABLE class_room_links ADD CONSTRAINT class_room_links_room_no_overlap
  EXCLUDE USING gist (physical_room_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);

-- FR-E1: one live evaluation per (round, component, target).
CREATE UNIQUE INDEX evaluations_one_per_class_target ON evaluations (round_id, component_id, target_class_id)
  WHERE status <> 'void' AND target_class_id IS NOT NULL;
CREATE UNIQUE INDEX evaluations_one_per_area_target ON evaluations (round_id, component_id, target_area_id)
  WHERE status <> 'void' AND target_area_id IS NOT NULL;

-- One waiting request per (evaluation, type) and per (late entry target).
CREATE UNIQUE INDEX requests_one_waiting_per_eval ON requests (evaluation_id, type)
  WHERE status = 'waiting' AND evaluation_id IS NOT NULL;

-- Audit log is append-only (works whatever DB role the app uses).
CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();
