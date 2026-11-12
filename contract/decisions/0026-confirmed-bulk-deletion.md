# ADR 0026: Destructive agent bulk deletion requires explicit confirmation

- Date: 2026-08-31
- Status: accepted
- Contract version: 130
- Supersedes: none
- Origin: contract v130 (no ticket named), backfilled 2026-11

## Context

Agents needed to delete many missions or objectives at once.

## Decision

`ovld protocol delete-missions` and `delete-objectives` take one to 100 unique references, preflight every target and its authorization before writing, and are all-or-nothing. `--confirm` (MCP `confirm: true`) is a deliberate destructive-action gate: an agent must first show the resolved list to the user and receive an affirmative response. The MCP tools carry the destructive annotation and forward only to these Protocol operations.

## Consequences

- Deletion keeps the existing soft-delete cascades and Run Queue cleanup.

## Alternatives considered

Not recorded.
