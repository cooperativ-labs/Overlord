# ADR 0106: Retain the status preceding completion

- Date: 2026-11-25
- Status: accepted

## Context

Users need to undo completion from the mission list on any device. Status changes have multiple writers and existing change records do not retain the old status.

## Decision

Store the preceding status on the mission while it is complete, and expose it as an optional nullable REST mission field. Database triggers maintain the value atomically for every writer, clear it on project changes or leaving completion, and retain it between complete statuses. Historical completions cannot be backfilled reliably and remain null. A deleted or no longer valid status is not a valid restore target.

## Consequences

Contract impact: minor. Both database adapters and the REST projection change together; existing consumers can ignore the additive field. All status writers share the invariant without duplicating it. SQLite uses an after-update trigger and PostgreSQL uses a before-update trigger.

## Alternatives considered

Browser storage cannot support other devices or status writers. Updating individual services risks missing one of the existing status paths.
