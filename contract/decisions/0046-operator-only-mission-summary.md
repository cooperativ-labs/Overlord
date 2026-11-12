# ADR 0046: Mission summaries are an operator-only surface with explicit eligibility

- Date: 2026-10-24
- Status: accepted
- Contract version: 166
- Supersedes: none
- Origin: contract v166 and v167 (coo:1202), backfilled 2026-11

## Context

Operators needed a per-mission summary of current-run evidence, risks and suggestions.

## Decision

`missions.summary_enabled` is the only source of eligibility; it was set false for every existing mission and defaults true for new ones. Summaries are composed by a guarded, generation-checked worker job and replaced in place. The summary, its evidence and the seen marker are never sent to agents: no Protocol, MCP or CLI surface exposes them, now or later, an explicit exemption from REST/MCP parity.

## Consequences

- Ineligible missions never get a summary row or compose job.

## Alternatives considered

Not recorded.
