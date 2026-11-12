# ADR 0012: Shipped components declare a conformance manifest

- Date: 2026-06-09
- Status: accepted
- Contract version: 0.2-draft
- Supersedes: none
- Origin: foundational; first recorded in the contract at 0.2-draft (no change summary explains it), backfilled 2026-11

## Context

Connectors, extensions, database adapters, auth providers and REST modules ship independently of the core and must be checked against the contract they were built for.

## Decision

Every shipped component carries a `conformance-manifest.yaml` that declares the contract version it was validated against, its component type and key, and every capability, extension point and vocabulary extension it uses, validated by `ovld contract check` against [conformance-manifest.schema.yaml](../conformance-manifest.schema.yaml). ADR 0009 later fixed how the declared version relates to `VERSION`.

## Consequences

- Integration of a component without a passing manifest is not sanctioned.
- Manifest version stamping follows ADR 0009.

## Alternatives considered

Not recorded.
