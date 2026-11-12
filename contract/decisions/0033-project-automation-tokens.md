# ADR 0033: Project automation tokens are default-deny and project-scoped

- Date: 2026-09-28
- Status: accepted
- Contract version: 151
- Supersedes: none
- Origin: contract v151 (coo:1093), backfilled 2026-11

## Context

Automation needed a token that can read and create missions in chosen projects only.

## Decision

A third `USER_TOKEN` preset, `project_automation`, carries a required, immutable selection of projects (`user_token_projects`) from which workspace consent is derived. Authorization is default-deny at two layers: a published route allowlist (everything else 404s before a handler) and one project-scope predicate that makes anything outside the selection read as 404 and filters lists, search, sync and SSE before pagination. Missions created by a direct `out_` bearer are stamped with the creating token's id (soft reference) and label snapshot.

## Consequences

- An audit omission fails closed.
- OAuth approval still issues `mission_lifecycle` and never a project allowlist.

## Alternatives considered

- An all-projects setting: not offered (the entry states there is none); reasons not recorded.
