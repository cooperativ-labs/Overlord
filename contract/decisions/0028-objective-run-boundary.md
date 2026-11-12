# ADR 0028: Objectives record an explicit run boundary

- Date: 2026-09-07
- Status: accepted
- Contract version: 133
- Supersedes: none
- Origin: contract v133 (coo:879), backfilled 2026-11

## Context

Clients inferred where an objective's latest run began from delivery order, which fails after a reopen.

## Decision

`objectives.reopened_at` is a nullable, last-wins timestamp stamped when an `executing`, `pending_delivery` or `complete` objective is set back to `draft`. A post-delivery re-attach is not a reopen. Clients split deliveries, terminal sessions and file changes into runs at that moment and fall back to delivery-order inference only when it is null. Reopening deletes nothing.

## Consequences

- Mission summary evidence uses the current run (ADR 0046).

## Alternatives considered

Not recorded.
