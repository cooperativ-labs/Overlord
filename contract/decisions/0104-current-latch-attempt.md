# ADR 0104: Correlate Mobile objective conversations with the current Latch attempt

- Date: 2026-11-22
- Status: accepted
- Contract version: 182.1.0
- Supersedes: none
- Amends: 0020, 0062, 0065

## Context

Mission terminal lists retain older sessions even after a direct relaunch.
Compose needs the current attempt for one objective and can display up to 100
objectives drawn from several readable workspaces.

## Decision

Add optional nullable `currentTerminalSession` to `ObjectiveTranscriptItemDto`.
After authorizing the page, select the latest non-deleted, non-local-mutation
request by creation time and ID for each active objective. Interpret only that
request's provider mapping and return it only for a Latch session without
confirmed exit. The end-session transaction uses the same active states and
request selection with its existing objective revision check. Mission detail
and history still select their own list of retained terminal sessions.

Allow an opt-in native Latch v2 client in Overlord Mobile. An Overlord identifier
confers no Latch grant. Mobile must independently authenticate the paired host,
match a unique running connector session with Latch source kind `overlord` and
the exact execution request ID, and revalidate the attempt and grants on open
and before writes. Missing capability or correlation falls back to the mission
panel. Mobile keeps conversation content in memory and clears it on access loss.

Overlord-owned lifecycle actions retain the existing mission and runner
authorization checks. A Latch-backed Overlord question answer uses its
`session:attach` and revision gates and runner delivery. Control-plane answers
retain their own authorized supervisor path. Latch Hub requests and conversation
actions belong to Latch and use its per-operation grants.

## Consequences

Contract impact: minor. Existing readers accept the added field, and newer
readers treat omissions as unavailable. Older gateways without provenance
cannot verify an objective binding. The page query uses existing request
metadata on both editions and requires no migration. Overlord never stores
Mobile pairing credentials or relays Hub content. A host can authorize broader
Latch access than the objective binding shown by Mobile. Hub writes and
Overlord revalidation are separate operations, so an action already dispatched
can finish on its original attempt.

## Alternatives considered

Using the most recent mapped terminal can expose an older Latch conversation
after a direct relaunch. Fetching mission details individually adds fan-out and
still leaves that ambiguity. Proxying Hub traffic through the backend would
require a second credential and conversation transport boundary.
