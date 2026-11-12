# ADR 0040: Opt-in all-workspaces write scope for a Knowledgebase connection

- Date: 2026-10-06
- Status: accepted
- Contract version: 158
- Supersedes: none
- Origin: contract v158 (coo:1117), backfilled 2026-11

## Context

Choosing a write grant per message was friction for people who always allow edits.

## Decision

`account_connections.assistant_write_scope` is closed `per_request` (default) or `all_workspaces`. With `all_workspaces` every run may write any workspace the connection is authorized for, without a per-message grant. Existing rows became `per_request`, so nobody's access widened on upgrade. The outbound client re-reads the row on every call, so turning it off refuses the next write.

## Consequences

- `ChatRunDto.knowledgebaseWrite` still reports only a per-message grant.

## Alternatives considered

Not recorded.
