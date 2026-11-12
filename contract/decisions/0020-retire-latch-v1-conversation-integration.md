# ADR 0020: Retire the Latch v1 conversation-observation integration

- Date: 2026-08-21
- Status: accepted
- Contract version: 108
- Supersedes: none
- Origin: contract v108 (coo:815), backfilled 2026-11

## Context

Latch protocol major 2 removed the conversation commands Overlord used to observe terminal sessions.

## Decision

Overlord keeps Latch discovery and persistent-terminal create, inspect, open, attach and stop, and removes the v1 conversation integration: no `latch events`, `latch send`, session interaction capabilities, harness-event ingest routes, pending-input resolution, event cursor or `TerminalSessionDto.observation`. A future conversation surface must be a native client of Latch's v2 Conversation Hub. Protocol attach, update and deliver stay independent of Latch.

## Consequences

- ADR 0025 is the first native v2 Hub client (answer delivery).

## Alternatives considered

- Adapting or emulating the deleted v1 conversation surface: rejected (the entry states Overlord does not do so).
