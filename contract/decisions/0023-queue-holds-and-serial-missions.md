# ADR 0023: Run Queue holds are waiting or blocked, and serial missions dispatch one entry

- Date: 2026-08-25
- Status: accepted
- Contract version: 122
- Supersedes: none
- Origin: contract v122 (coo:854), backfilled 2026-11

## Context

A `mission_busy` hold written as `blocked` was permanent, and the dispatcher ignored `missions.allow_parallel_objectives`.

## Decision

`blocked` means a human must act (`blockedReason`), and `waiting` means eligible or held on a self-clearing condition (`waitingReason`). The dispatcher re-evaluates both on every tick. A serial mission has at most one dispatched or running entry across all queues of the project, enforced in the database by `createExecutionRequest` (`objective_sibling_active`, 409). Failed dispatches return the entry to `waiting` with `retry_pending` until a ceiling of three attempts, after which it is `blocked`.

## Consequences

- Holds clear without queue mutation or human action when their cause is gone.

## Alternatives considered

- Leaving the serial-mission rule as a planner convention: replaced by database enforcement; reasons beyond the stated guarantee not recorded.
