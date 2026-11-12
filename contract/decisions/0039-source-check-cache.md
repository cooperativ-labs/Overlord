# ADR 0039: Cache positive Knowledgebase source checks for 30 seconds

- Date: 2026-10-06
- Status: accepted
- Contract version: 157
- Supersedes: none
- Origin: contract v157 (coo:1117), backfilled 2026-11

## Context

The upstream MCP server limits each token subject and client to 120 tool calls per minute, and its `get_related` access check accepts one node at a time.

## Decision

Overlord keeps single-flight source checks and caches only positive answers, per owner, for 30 seconds (previously 15). The owner's connection row is still checked on every source check, so disconnect is immediate; upstream node revocation is observed within 30 seconds.

## Consequences

- A revoked node may remain visible for up to 30 seconds.

## Alternatives considered

Not recorded.
