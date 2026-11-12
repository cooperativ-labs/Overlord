# ADR 0005: Mark backfilled ADRs with their origin

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

ADRs written in phase 3 record decisions made months earlier. Without marking,
they read as if written at the time and can present reconstructed reasoning as
history.

## Decision

Backfilled ADRs use the standard format plus one header line,
`Origin: contract vN (ticket), backfilled YYYY-MM`. `Date:` is the original
date of the decision from git history, which requires an unshallowed clone.
Where the source records no alternatives, the ADR says "not recorded" rather
than inventing them.

## Consequences

- Readers can tell contemporary records from reconstructions.
- Backfill needs full git history.

## Alternatives considered

- Date backfilled ADRs on the day they are written: rejected because it hides
  when the decision took effect.
- No marking: rejected because reconstructed records would read as invented
  history.
