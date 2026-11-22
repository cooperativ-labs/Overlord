-- Coordinate change-feed writers and readers with one transaction-scoped
-- advisory lock instead of entity_changes table locks (ADR 0103).
--
-- Writers hold the gate in shared mode from before identity allocation until
-- commit or rollback. A BEFORE INSERT statement trigger takes it, so every
-- writer is covered, including direct SQL, multi-row and COPY inserts and
-- older backends that do not know about the gate. Feed readers and retention
-- take it in exclusive mode. Advisory locks do not conflict with the
-- SHARE UPDATE EXCLUSIVE lock that autovacuum holds, so neither side cancels
-- or waits for ordinary autovacuum.
--
-- A sequence value allocated outside the gate could commit below a cursor a
-- reader has already returned. The AFTER INSERT check therefore rejects any
-- row whose seq was not allocated after this statement took the gate: explicit
-- values, values from an earlier nextval() and values beyond the sequence.
BEGIN;

-- One key per entity_changes relation: the high half spells 'ovld' and the low
-- half is the table OID, so databases or schemas that each hold a feed do not
-- serialize against one another.
CREATE FUNCTION entity_changes_feed_gate_key()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT (1870031972::bigint << 32) | 'entity_changes'::regclass::oid::bigint
$$;

CREATE FUNCTION entity_changes_feed_write_gate()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(entity_changes_feed_gate_key());
  -- The highest value any session had allocated once the gate was held. Every
  -- row this statement inserts must be above it.
  PERFORM set_config(
    'overlord.entity_changes_gate_floor',
    COALESCE(
      pg_sequence_last_value(pg_get_serial_sequence('entity_changes', 'seq')::regclass),
      0
    )::text,
    true
  );
END;
$$;

CREATE FUNCTION entity_changes_feed_read_gate()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Upgrading a held shared gate can deadlock against another upgrader and
  -- would wait for this transaction's own uncommitted rows. Fail fast instead.
  IF COALESCE(current_setting('overlord.entity_changes_gate_floor', true), '') <> '' THEN
    RAISE EXCEPTION 'entity_changes feed read or prune inside a feed-writing transaction'
      USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(entity_changes_feed_gate_key());
END;
$$;

CREATE FUNCTION entity_changes_gate_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM entity_changes_feed_write_gate();
  RETURN NULL;
END;
$$;

CREATE FUNCTION entity_changes_gate_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gate_floor bigint := current_setting('overlord.entity_changes_gate_floor')::bigint;
  allocated bigint := COALESCE(
    pg_sequence_last_value(pg_get_serial_sequence('entity_changes', 'seq')::regclass),
    0
  );
BEGIN
  IF EXISTS (
    SELECT 1 FROM gated_changes WHERE seq <= gate_floor OR seq > allocated
  ) THEN
    RAISE EXCEPTION 'entity_changes.seq must be allocated by its identity default while the feed gate is held'
      USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER entity_changes_gate_before_insert
  BEFORE INSERT ON entity_changes
  FOR EACH STATEMENT EXECUTE FUNCTION entity_changes_gate_before_insert();

CREATE TRIGGER entity_changes_gate_after_insert
  AFTER INSERT ON entity_changes
  REFERENCING NEW TABLE AS gated_changes
  FOR EACH STATEMENT EXECUTE FUNCTION entity_changes_gate_after_insert();

COMMIT;
