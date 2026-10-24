-- coo:1199 breaking cutover: per-file rationales are no longer delivery-report
-- evidence. Same semantics as the SQLite migration of the same name: remove only
-- persisted presentation items whose provenance is `change_rationale`, keeping
-- every other item in stored order.
BEGIN;

UPDATE deliveries
   SET payload_json = jsonb_set(
         payload_json,
         '{deliveryReport,presentation,tradeoffsMade}',
         COALESCE(
           (SELECT jsonb_agg(item.value ORDER BY item.ordinality)
              FROM jsonb_array_elements(payload_json #> '{deliveryReport,presentation,tradeoffsMade}')
                     WITH ORDINALITY AS item(value, ordinality)
             WHERE item.value ->> 'source' IS DISTINCT FROM 'change_rationale'),
           '[]'::jsonb))
 WHERE jsonb_typeof(payload_json #> '{deliveryReport,presentation,tradeoffsMade}') = 'array'
   AND jsonb_path_exists(
         payload_json,
         '$.deliveryReport.presentation.tradeoffsMade[*] ? (@.source == "change_rationale")');

UPDATE deliveries
   SET payload_json = jsonb_set(
         payload_json,
         '{deliveryReport,presentation,humanActions}',
         COALESCE(
           (SELECT jsonb_agg(item.value ORDER BY item.ordinality)
              FROM jsonb_array_elements(payload_json #> '{deliveryReport,presentation,humanActions}')
                     WITH ORDINALITY AS item(value, ordinality)
             WHERE item.value ->> 'source' IS DISTINCT FROM 'change_rationale'),
           '[]'::jsonb))
 WHERE jsonb_typeof(payload_json #> '{deliveryReport,presentation,humanActions}') = 'array'
   AND jsonb_path_exists(
         payload_json,
         '$.deliveryReport.presentation.humanActions[*] ? (@.source == "change_rationale")');

COMMIT;
