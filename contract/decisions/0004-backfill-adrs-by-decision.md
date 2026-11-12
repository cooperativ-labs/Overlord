# ADR 0004: Backfill ADRs by decision, not by version

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

The 71 provenance changelog entries contain decisions of very different
weight. One ADR per version would bury the binding choices among additive
changes; none would leave the reasons for standing choices unrecorded.

## Decision

A version receives an ADR only when it made a choice that still binds:
architecture, security, tenancy or isolation, data meaning, migration
semantics, a service boundary, or a retired surface. Purely additive versions
stay changelog-only. Foundational choices that no summary explains — the two
editions, closed and open vocabularies, conformance manifests, the duplicated
branch-planning algorithm pinned by golden vectors — receive their own ADRs.
The backfill happens in phase 3 of the migration plan, newest to oldest, so
that supersession is known before an older record is written.

## Consequences

- An estimated 40–55 backfilled ADRs plus 6–10 foundational ones.
- The same rule governs new work: an ADR is required for the same kinds of
  decision, and the release range check enforces it for changes to
  `architecture.md`, `protocol.md`, `authorization.md`, `data/README.md` and
  migrations.

## Alternatives considered

- One ADR per version: rejected as noise.
- No backfill: rejected because the reasons for standing choices would remain
  only in non-normative provenance.
