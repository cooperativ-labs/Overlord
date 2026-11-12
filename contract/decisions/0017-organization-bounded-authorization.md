# ADR 0017: Cross-workspace authorization is organization-bounded

- Date: 2026-08-19
- Status: accepted
- Contract version: 95
- Supersedes: none
- Origin: contract v95 (no ticket named), backfilled 2026-11

## Context

Tokens and requests could reach several workspaces, and some operations fell back to a caller's oldest membership when no workspace was named.

## Decision

OAuth `USER_TOKEN`s bind to exactly one organization and consent to an explicit non-empty workspace allowlist or to every current and future workspace of that organization. Runtime access is always consent intersected with live membership and per-workspace RBAC; legacy tokens backfill only their recorded issuance workspace. Each request resolves an immutable `authorizedWorkspaces` set by operation taxonomy (entity-addressed, single-workspace, aggregate parentless, parentless write), and no operation falls back to an oldest membership. Cross-workspace search uses deterministic, non-redistributed per-workspace quotas with no cross-organization fan-out.

## Consequences

- [authorization.md](../authorization.md) "User tokens" and [architecture.md](../architecture.md) "Workspace resolution taxonomy" carry the rule.
- Inbox attachment storage placement (ADR 0047) selects a storage workspace by oldest qualifying membership; that is storage placement for a profile-owned item, recorded there as a tension to resolve.

## Alternatives considered

Not recorded.
