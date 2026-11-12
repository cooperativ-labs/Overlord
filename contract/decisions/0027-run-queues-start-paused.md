# ADR 0027: Run Queue launch is user-controlled

- Date: 2026-09-03
- Status: accepted
- Contract version: 131
- Supersedes: none
- Origin: contract v131, v139 (coo:977) and v146 (coo:1044), backfilled 2026-11

## Context

Queues dispatched as soon as entries were added, so queueing work could launch agents the user had not chosen to start.

## Decision

Every newly created queue starts paused, and adding or moving entries never resumes it; dispatch starts only when a user resumes the queue or directly runs one of its objectives, which resumes the containing queue in the same transaction. Recovery actions pause transactionally: forced entry removal and disconnecting an active objective back to `draft` or `submitted` pause the containing queue before any dispatch tick (v139). One exception (v146): a lazily created mission queue whose objective sits behind an already-running unqueued sibling seeds that sibling ahead as a `running` entry and starts unpaused.

## Consequences

- Explicit pause and resume remain queue-definition mutations requiring `project:update`.

## Alternatives considered

Not recorded.
