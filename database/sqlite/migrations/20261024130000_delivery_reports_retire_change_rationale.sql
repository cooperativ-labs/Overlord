-- coo:1199 breaking cutover: per-file rationales are no longer delivery-report
-- evidence. Composed presentations persisted before the cutover may carry
-- tradeoffs (or actions) whose provenance is `change_rationale`; the contract
-- now admits only `agent` and `deterministic_rule`, and the strict read schema
-- would otherwise discard the whole report. Remove only those items. Summaries,
-- markdown, the agent report and every other item keep their stored order.
-- Legacy top-level payload keys such as `changeRationales` stay as inert,
-- never-read history.
BEGIN IMMEDIATE;

UPDATE deliveries
   SET payload_json = json_set(
         payload_json,
         '$.deliveryReport.presentation.tradeoffsMade',
         (SELECT json_group_array(json(item.value) ORDER BY item.key)
            FROM json_each(deliveries.payload_json, '$.deliveryReport.presentation.tradeoffsMade') AS item
           WHERE json_extract(item.value, '$.source') IS NOT 'change_rationale'))
 WHERE json_valid(payload_json)
   AND json_type(payload_json, '$.deliveryReport.presentation.tradeoffsMade') = 'array'
   AND EXISTS (
         SELECT 1
           FROM json_each(deliveries.payload_json, '$.deliveryReport.presentation.tradeoffsMade') AS item
          WHERE json_extract(item.value, '$.source') = 'change_rationale');

UPDATE deliveries
   SET payload_json = json_set(
         payload_json,
         '$.deliveryReport.presentation.humanActions',
         (SELECT json_group_array(json(item.value) ORDER BY item.key)
            FROM json_each(deliveries.payload_json, '$.deliveryReport.presentation.humanActions') AS item
           WHERE json_extract(item.value, '$.source') IS NOT 'change_rationale'))
 WHERE json_valid(payload_json)
   AND json_type(payload_json, '$.deliveryReport.presentation.humanActions') = 'array'
   AND EXISTS (
         SELECT 1
           FROM json_each(deliveries.payload_json, '$.deliveryReport.presentation.humanActions') AS item
          WHERE json_extract(item.value, '$.source') = 'change_rationale');

COMMIT;
