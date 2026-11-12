# ADR 0041: Owner-only unredacted chat diagnostics are an explicit privacy exception

- Date: 2026-10-07
- Status: accepted
- Contract version: 159
- Supersedes: none
- Origin: contract v159 (coo:1125, coo:1127), backfilled 2026-11

## Context

Diagnosing assistant behaviour needed the exact provider exchanges, which the curated chat projection deliberately hides.

## Decision

`chat_diagnostics` stores append-only, unredacted, untruncated observations (provider SDK requests and chunks, errors, raw event and tool transitions, thread REST bodies) for the thread lifetime, readable only by the thread owner through `GET /api/chat/threads/:id/diagnostics`. This is the explicit exception to the curated-chat privacy and source-projection rules, including previously revoked content. Diagnostics never enter snapshots, SSE, global logs, search, webhooks or provider history, and reading them invokes no tool and changes no authorization.

## Consequences

- Storage grows with observed exchanges; no content-size cap is imposed.

## Alternatives considered

Not recorded.
