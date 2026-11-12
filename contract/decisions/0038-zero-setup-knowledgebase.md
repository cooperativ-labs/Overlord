# ADR 0038: Default Knowledgebase server and a platform key derived from the auth secret

- Date: 2026-10-06
- Status: accepted
- Contract version: 156
- Supersedes: none
- Origin: contract v156 (coo:1121), backfilled 2026-11

## Context

Connecting a Knowledgebase required an operator to set server and encryption variables.

## Decision

With `KNOWLEDGEBASE_MCP_URL` unset the deployment uses the standard server; operators may override or turn it off, and users never choose a server. The key ring gains a platform key derived by HKDF-SHA256 from `BETTER_AUTH_SECRET` (reserved `platform-*` ids), used when no explicit key is set; Knowledgebase re-seals rows in place between the explicit and platform keys. Rotating the secret without a dedicated key makes platform-sealed credentials unreadable and asks owners to reconnect.

## Consequences

- `BETTER_AUTH_SECRET` keeps its meaning; its rotation now also affects platform-sealed connections.

## Alternatives considered

Not recorded.
