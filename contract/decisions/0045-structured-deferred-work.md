# ADR 0045: Deferred work is structured, agent-authored future work that nothing rewrites

- Date: 2026-10-24
- Status: accepted
- Contract version: 166
- Supersedes: none
- Origin: contract v140 (coo:986) and v166 (coo:1202), backfilled 2026-11

## Context

Deferred work mixed leftover slices of the current objective with new work, and from v139 the composer rewrote items, which changed their identity.

## Decision

Deferred work is recommended new work outside the current mission (v140). Agents write it as `DeferredWorkInputV1` objects (`title`, `change`, `location`, `doneWhen`); strings and unknown keys are rejected. Each item's id is derived from its index and content digest and pinned by fixtures. Nothing rewrites an item: `presentation.deferredWork` is the eligible subset of the agent items, verbatim. Historical deferred work and its resolutions were dropped.

## Consequences

- Promotion builds the objective instruction from the structured fields.
- The v139 rewrite rule is superseded.

## Alternatives considered

- Rewriting each item as a standalone objective statement in the composer (v139): withdrawn by v166.
