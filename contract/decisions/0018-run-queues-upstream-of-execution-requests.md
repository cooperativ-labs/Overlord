# ADR 0018: Project Run Queues are planning state upstream of execution requests

- Date: 2026-08-20
- Status: accepted
- Contract version: 103
- Supersedes: none
- Origin: contract v103, v104 and v106 (Run Queue engine coo:786), backfilled 2026-11

## Context

Sequencing work across objectives needed an authoritative model without changing the runner and virtual-target delegation surface.

## Decision

Project Run Queues (`run_queues`, `run_queue_entries`) are the authoritative, target-neutral sequencing model ahead of `execution_requests`. A dispatcher resolves target and config at dispatch and creates an ordinary execution request (`requested_source = run_queue`); runners and gateways never see queues. Agents reach the same Run Queue service through Protocol and MCP, never a second implementation. Queues may be mission-scoped and are created lazily; entry operations require `execution_request:create` and queue-definition operations, including queue display order (`PATCH /api/projects/:id/run-queues/order`), require `project:update`. `autoAdvance` is a derived compatibility projection.

## Consequences

- The v106 "queued span" ordering rule was replaced by ADR 0030.
- Queue launch control is ADR 0027; holds and the serial-mission guarantee are ADR 0023.

## Alternatives considered

Not recorded.
