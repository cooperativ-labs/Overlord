# ADR 0021: Track file changes through an objective ledger; evidence never blocks delivery

- Date: 2026-08-23
- Status: accepted
- Contract version: 116
- Supersedes: none
- Origin: contract v112, v113, v114, v115 and v116, backfilled 2026-11

## Context

File-change attribution relied on worktree deltas, which misattribute work when objectives share a checkout and could block delivery.

## Decision

Delivery requires only its summary; change tracking and advisory evidence never reject a lifecycle transition. The CLI owns an owner-only, cross-process-locked local ledger keyed by objective and protocol session; the working directory alone never selects an objective. Connector callbacks append `declared_edit` evidence only when the connector codec normalizes a `file.edited` event with a bounded in-workspace path; other callbacks record bounded hook health. Evidence reaches the backend only as metadata through Protocol `sync-changes`; no backend reads an execution-target filesystem, and no content, diff, command, transcript, environment or fingerprint is persisted or transmitted.

## Consequences

- ADR 0044 later removed per-file rationale and window metadata and made the list cumulative per resource.

## Alternatives considered

- Keeping the VCS-delta path as authoritative: retired (shadow-only in v114, removed in v116); reasons beyond misattribution not recorded.
