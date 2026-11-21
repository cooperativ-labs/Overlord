-- The feed remains authoritative. PostgreSQL delivers this empty wake hint on
-- commit and folds identical notifications within a transaction.
BEGIN;

CREATE FUNCTION notify_entity_changes_inserted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM inserted_changes) THEN
    PERFORM pg_notify('overlord_entity_changes', '');
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER entity_changes_insert_notify
  AFTER INSERT ON entity_changes
  REFERENCING NEW TABLE AS inserted_changes
  FOR EACH STATEMENT EXECUTE FUNCTION notify_entity_changes_inserted();

COMMIT;
