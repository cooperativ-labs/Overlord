# ADR 0007: Keep REST paths; no `/api/v1` move

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

Introducing a versioned OpenAPI description invites moving every route under a
version prefix such as `/api/v1`.

## Decision

Paths stay as they are. The OpenAPI `info.version` starts at `1.0.0`. The
existing `/search/v2` and `/search/v3` routes and the
`/api/virtual-targets/v1/*` surface stay.

## Consequences

- No change for the web app, CLI, desktop, mobile, runner or gateways.
- API compatibility is expressed by `info.version` and the contract version,
  not by the path.

## Alternatives considered

- Move every route under `/api/v1`: rejected because it would touch every
  client for no gain in compatibility.
