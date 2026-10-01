-- T28 retention (BR-D3, 12-security §3): audit_logs stays append-only, except that `retention.run` may DELETE
-- rows inside a transaction that set `zw.retention = 'on'` (set_config(..., true) is transaction-local).
-- UPDATE is never allowed.
CREATE OR REPLACE FUNCTION audit_logs_block_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('zw.retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
