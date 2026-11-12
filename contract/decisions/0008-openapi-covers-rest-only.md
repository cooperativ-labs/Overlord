# ADR 0008: OpenAPI covers REST only

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

Overlord has several interfaces besides REST: the `ovld protocol` agent
protocol, the MCP tools and the connector hook surface.

## Decision

`api/openapi.yaml` describes the REST surface only. `ovld protocol` stays
specified by `protocol-commands.yaml` and `protocol.md`, and the MCP tools by
the generated tool catalog. All of them are versioned by the one contract
`VERSION`.

## Consequences

- One contract version covers every interface; each interface keeps the
  specification format that suits it.

## Alternatives considered

- Describe the protocol and MCP tools in OpenAPI as pseudo-operations:
  rejected because neither is HTTP and the result would mislead generators.
