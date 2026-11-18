# ADR 0080: Cross-mission decisions join whole-snapshot seen coverage

Status: accepted
Date: 2026-11-18

Amends ADR 0076 and extends ADR 0079. Contract impact: major (shared deterministic
seen algorithm and fixtures).

## Decision

Return optional `itemsWatermark`, the newest resolved_at of a live target item closed
by another mission's agent, and `itemsTruncated`, whether the closed list exceeds 100.
Use the same live source-delivery predicate as listMissionItems and a partial index on
(mission_id, workspace_id, resolved_at DESC). Person and own-mission closes do not move it.
Include this source in the server seen upper bound; preserve delivery/question and retained
narrative sources and the meanings of watermark and narrativeWatermark.

Web and Electron extend the existing items coverage group. Its signature includes every
cross-mission row and all current status/provenance/link fields. Each row must be displayed
for two seconds before that group is covered. A collapsed header alone never counts.
New decisions open Resolved on the next visit; the visit baseline stays fixed. All required
narrative, action, risk and suggestion groups still need their current signatures covered,
with complete, successfully loaded data and every watermark backed by displayed evidence.
A remount starts with empty coverage. A capped resolved list blocks acknowledgement of the
whole snapshot; the UI explains this durable limit rather than silently clearing hidden rows.

Resolver links navigate to the closing mission/objective, with Done/Dismissed, reason,
not-delivered-yet and existing Restore. Delivery cards render closedElsewhere directly from
the live DTO; they never amend the immutable report, receipt or summary text.

## Compatibility and alternatives

The additions are optional for old-server decoding. Older clients ignore them; their existing
watermarks keep their meanings. Updated iOS consumes the revised fixture in the next objective.
There is no new coverage group or scalar seen store. A header-only or newest-timestamp-only
acknowledgement was rejected because it would clear hidden evidence. Pagination of closed rows
is deferred in favor of conservatively keeping capped snapshots unread. The additive index
migration changes no persisted row meanings. Application rollback may leave the index installed.
No narrative writer, draft projection, receipt rewrite or release gate changes.
