# coo:963 — Human actions rail on the Feed page

## Problem

Agents already report follow-up human actions in the delivery report
(`deliveries.payload_json.deliveryReport.presentation.humanActions`). They are rendered
only inside one delivery card on the mission panel, so the operator sees them once, at
the moment the delivery lands, and then they are gone. Nothing collects them across
missions, and nothing records whether an action was ever done.

## Design (contract v136)

**Read**: `GET /api/human-actions` returns a `HumanActionsDto` across every workspace the
caller can read missions in (same membership fan-out as the activity feed). Each item is
one `HumanActionV1` entry from the latest delivery of an objective, decorated with its
workspace/project/mission/objective context and an optional resolution. Open items lead,
blocking ones first, then newest delivery first; resolved items are appended newest-first
only when `includeResolved=1`. Reads are bounded to deliveries from the last 90 days and
never expose raw payload JSON.

**Resolve**: `PUT /api/human-actions/:deliveryId/:actionId/resolution` with
`{ status: 'done' | 'dismissed' }` upserts a row in the new `human_action_resolutions`
table; `DELETE` reopens. Both require `mission:update` on the delivery's workspace and emit
an `entity_changes` row (`entity_type = 'human_action_resolution'`) so the rail refreshes
over the realtime link.

**Store**: `human_action_resolutions(delivery_id, action_id)` keyed on the stable action id
inside the delivery presentation. The compose worker preserves those ids (composed actions
are matched back to their `agentReport` / deterministic-rule source id), so a resolution
survives asynchronous composition. The action rows themselves are _not_ duplicated: the
delivery report stays the single source of truth for the text, and a resolution is a small
per-user-visible decision layered on top.

**UI**: a left rail on `/feed` lists open actions grouped by mission → objective with
category chip, blocking marker, reason, checkbox (done), dismiss, and reopen. Clicking a
group opens the mission drawer at the objective. The sidebar Feed entry shows the open
count so the number is visible from any page.

## Tradeoffs

- Derived-at-read from delivery JSON rather than a materialized `human_actions` table.
  Fewer write paths (deliver, record-work, compose) to keep in sync and every historical
  delivery shows up immediately. The cost is a bounded JSON scan of recent deliveries; a
  cheap text prefilter keeps only deliveries that actually carry actions.
- Latest delivery per objective only. A re-delivered objective supersedes its earlier
  action list; older lists could carry stale instructions.

## Follow-ups (added as objectives on coo:963)

1. Make agent-reported human actions more complete: require `reason`, add optional
   `command` / `verify` / `link` fields, and tighten connector, protocol-help, and MCP
   guidance so agents write actionable steps instead of one-liners.
2. Show resolution state on the mission-panel delivery card and let the operator check
   actions off there too (shared state with the rail).
3. Notify on delivery when blocking human actions are present (notification catalog type,
   desktop/mobile push), and badge the count in the desktop tray/dock.
