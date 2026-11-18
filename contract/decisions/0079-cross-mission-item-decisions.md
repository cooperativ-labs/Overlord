# ADR 0079: Same-project agent item decisions and live provenance

- Status: accepted
- Date: 2026-11-18
- Contract version: 177.0.0
- Supersedes: none

Amends ADRs 0060 and 0073 (own-mission agent item boundary), 0074 (resolver
projection), 0075 (acceptance linkage), 0076 and 0078 (preserved invariants).

## Context

Standalone decisions lacked a resolving delivery link and foreign items were always
skipped, so later verified work could not retire another mission's obligations.

## Decision

Agents may close items of any live mission in their attached mission's project
through the existing close-items and finalization paths. Existing own-mission
permissions stay in force. Foreign writes additionally require mission:update,
intersected with token consent; permission denial skips foreign entries only.
Other workspace/project/token-scope ids and deleted sources remain not_found.
A persistent restored_at protects a foreign decision reversed by a person.

Store resolving mission and session alongside the objective and delivery, backfill
legacy mission provenance from objectives, and enforce agent-only provenance with
a CHECK. First accepted delivery links still-closed standalone session decisions
once, before immutable receipt storage. Record-work has a private new source and
no session history. Acquire the complete affected mission set in global id order
at the outer transaction boundary, revalidate and restart on changed membership.
This replaces source-first ordering to prevent reciprocal close/link deadlocks.

Resolver display ids and closedElsewhere are live read projections. Restore and
source deletion may remove rows; they are not a historical audit snapshot. Neither
accepted reports nor receipts are rewritten. Target summary and publication rows
remain byte-identical, including evidence basis and freshness. Item actions never
schedule narrative composition. Stale/missing prose continues to accept valid closes;
publication is prose-only. Draft validation/CAS failure rolls back all unaccepted
work, and receipt replay performs no writes.

## Consequences

Contract impact: major. Callers relying on foreign ids being skipped now observe
closes when authorized. Own-mission inputs remain compatible. Both editions gain
nullable columns and indexes without rewriting reports. Older clients ignore the
optional provenance/projection additions. No release gate is waived and this ADR
claims no deployment. Discovery, target UI and seen-watermark behavior land in
later phases of coo:1278.

## Alternatives considered

Separate own/foreign close commands were rejected because they duplicate validation,
permission and lock rules. A snapshot added to accepted reports was rejected because
live restores must not rewrite immutable accepted evidence. Source-first locking
was rejected because reciprocal mission operations can deadlock.
