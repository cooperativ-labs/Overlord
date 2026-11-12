# ADR 0043: One implementation per workflow; one MCP tool catalog

- Date: 2026-10-23
- Status: accepted
- Contract version: 164
- Supersedes: none
- Origin: contract v164 (duplicate-functionality review; also v101 coo:781), backfilled 2026-11

## Context

REST, Protocol, MCP and the local connector shim had drifted copies of the same workflows and tool schemas.

## Decision

Domain logic that more than one surface needs lives once in `packages/core/service`; REST keeps only its authorization check and DTO mapping. MCP tools forward through Protocol to the established service operation instead of defining connector-only mutations (v101). MCP tool names, schemas and annotations are defined once in `@overlord/contract/mcp-tools`; hosted MCP projects it and the local shim's tool list is generated from it and never hand-edited.

## Consequences

- `yarn connectors:mcp-tools` and `connectors:check` enforce the generated shim.

## Alternatives considered

Not recorded.
