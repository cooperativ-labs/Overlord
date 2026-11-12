# ADR 0030: Run Queue order and mission objective order are one sequence

- Date: 2026-09-18
- Status: accepted
- Contract version: 143
- Supersedes: none
- Origin: contract v143 (no ticket named), backfilled 2026-11

## Context

Under the v106 "queued span" rule an unqueued objective between two queued ones stopped queue order from reaching the mission, and only mission-scoped queues retired.

## Decision

Queueing an objective cascades to the later unstarted objectives of its mission; queue reorders write through to the position slots queued objectives occupy and mission reorders write back into queues; dequeueing an unstarted objective moves it to the end of the mission; any non-default queue that has held an entry retires once it holds none, however its last entry left, while a pristine queue and the default queue are kept.

## Consequences

- Clients must tolerate a queue id disappearing after any entry mutation or delivery.

## Alternatives considered

- The v106 "queued span" rule: replaced by this decision.
