# ADR 0107: Allow explicit deletion of legacy default Run Queues

- Date: 2026-11-26
- Status: accepted
- Contract version: 182.5.0
- Amends: [ADR 0030](0030-queue-order-is-mission-order.md)

## Context

The original Run Queue migration seeded a default queue in projects with legacy
auto-advance objectives. Current queueing can create mission queues on demand,
so a project can operate without a default queue.

## Decision

Use the existing project-authorized queue-definition delete for legacy default
queues. An occupied queue requires a different live destination in the same
project. Append its entries in order and soft-delete the source in one
transaction. The default designation still controls order and the Protocol
fallback while the queue exists. Automatic retirement continues to skip it.

## Consequences

- A project can end up with zero live queues. Future queueing can create a mission queue.
- Existing REST, Protocol, and MCP callers use the same parameters and success response.
- Existing stored rows need no migration.

## Alternatives considered

- Bulk deletion would remove project queues without an explicit operator decision.
- Promoting a replacement would change which queue receives implicit Protocol enqueues.
