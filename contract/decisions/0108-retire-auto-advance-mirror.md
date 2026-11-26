# ADR 0108: Retire the stored auto-advance mirror

- Date: 2026-11-26
- Status: accepted
- Contract version: 182.5.1
- Supersedes: none

## Context

Run Queue entries already determine automatic dispatch. The original SQLite
and PostgreSQL migrations backfilled entries from the old flag. Current
objective detail and activity-feed decoders in Overlord Mobile require the
`autoAdvance` response key. Older CLI and MCP clients can also send the
legacy creation and update options. The web activity feed also uses the
compatibility boolean to draw its queued indicator. The existing objective
list carries explicit queue-entry details, while feed rows carry the boolean.

## Decision

In this patch, keep the existing wire options and derive their response fields
from live entries. Translate legacy writes into the existing queue operations.
Stop consulting or maintaining the stored flag and remove the unused
post-delivery planner. The existing delivery tick, direct Run and mission
objective selectors continue to use their existing paths.

## Consequences

- Existing queue entries, ordering, execution requests and migration history
  carry forward without a backfill. The queued-first write-through to objective
  positions still runs.
- REST, Protocol, MCP and the activity feed retain their response shapes.
  Upgrading server binaries together avoids routing clients to an older server
  that still reads stale mirror values. A rollback to mirror-reading code
  requires rematerializing the mirror from live entries.
- A subsequent client transition uses explicit queue operations for mutations
  and accepts responses without the obsolete field. This client-only
  transition has no contract impact while it uses the current API. If the feed
  needs a replacement membership field before clients can migrate, add that
  field alongside the old one in a minor contract release.
- After the supported clients have migrated, a major contract release can
  remove the REST, Protocol, CLI and MCP aliases and the stored columns from
  SQLite and PostgreSQL. Leave historical migrations and execution requests
  intact.

## Alternatives considered

A coordinated immediate removal would break deployed mobile decoders and old
agent clients. Keeping mirror writes would preserve older server rollback
behavior but perpetuate two representations of live membership.
