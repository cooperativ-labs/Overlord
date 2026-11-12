# ADR 0036: Assistant Knowledgebase writes require an explicit user grant

- Date: 2026-10-05
- Status: accepted
- Contract version: 154
- Supersedes: none
- Origin: contract v154 (per:202.62e3), backfilled 2026-11

## Context

The assistant could read the Knowledgebase; writing notes needed authorization that model output could not manufacture.

## Decision

A write is authorized only by a per-message `knowledgebaseWrite` grant (connection and workspace) stored on the run, or by the connection's opt-in `all_workspaces` scope (ADR 0040). OAuth consent, earlier runs and model output never authorize a write; without a grant no write tool is declared and any write is refused before reaching the Knowledgebase. Writes use reviewed tools with revision guards, run sequentially after reads, and an interrupted write is `uncertain` and never retried. Backend credentials are never exported to agent processes.

## Consequences

- The Knowledgebase remains authoritative (its own 403 applies).

## Alternatives considered

Not recorded.
