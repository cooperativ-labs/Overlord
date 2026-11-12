# ADR 0044: Objective change tracking is a cumulative file list without per-file rationale

- Date: 2026-10-24
- Status: accepted
- Contract version: 165
- Supersedes: none
- Origin: contract v165 (coo:1199), backfilled 2026-11

## Context

Per-file rationale, VCS status and window/overlap metadata duplicated the delivery summary and were unreliable.

## Decision

A delivery explains outcome and rationale in its summary; "Files changed during this objective" is a compact, cumulative list grouped by resource with provenance `declared_edit`, `agent_declared` or unknown. Row identity is objective plus session-resolved resource plus path, and the resource comes from the authorized session, never a caller claim. Per-file rationale, VCS status and current-diff state are retired and rejected. The list is not a Git diff or proof of exclusive ownership. Native evidence counts only for successful edit outcomes.

## Consequences

- Amends ADR 0021: the quality, overlap and window metadata it described are removed.

## Alternatives considered

- Aliases, dual writes or compatibility DTOs: not adopted (the entry records a single breaking cutover); reasons not recorded.
