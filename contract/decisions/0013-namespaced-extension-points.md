# ADR 0013: Extensions use only declared, namespaced extension points

- Date: 2026-06-09
- Status: accepted
- Contract version: 0.2-draft
- Supersedes: none
- Origin: foundational; first recorded in the contract at 0.2-draft (no change summary explains it), backfilled 2026-11

## Context

Downstream forks and extensions add tables, metadata, endpoints and vocabulary values. Uncontrolled additions would collide with core names and couple extensions to core internals.

## Decision

Overlord is extended only through the extension points listed in [architecture.md](../architecture.md) "Extension Points" and [extension-points.yaml](../extension-points.yaml): extension tables are prefixed `ext_<name>_` with migration component `ext:<name>`, metadata keys are namespaced, REST extensions live under `/ext/<name>/`, and extensions react through service APIs, `entity_changes` and `outbox_messages` rather than writing core tables.

## Consequences

- Any other extension path is a contract violation that blocks shipping.
- New extension points require a contract change.

## Alternatives considered

Not recorded.
