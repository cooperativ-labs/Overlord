# ADR 0016: The harness capability descriptor is the single source of connector capability truth

- Date: 2026-08-01
- Status: accepted
- Contract version: 52
- Supersedes: none
- Origin: foundational; first recorded in the contract at version 52 (before the retained change summaries), backfilled 2026-11

## Context

The UI gates controls on what each agent harness can do. Claimed but unproven capabilities render controls that do nothing.

## Decision

Each connector ships `harness-capabilities.yaml`, validated by [harness-capabilities.schema.yaml](../harness-capabilities.schema.yaml). It is the only hand-authored source of agent-session capability truth: runtime gating input, CI contract, and the source of generated documentation and the compiled CLI catalog. Every `supported` capability is proved by an executable fixture CI runs; every other status is justified; the capability tier is derived from passing fixtures and never authored. Adapters make no network call.

## Consequences

- Generated descriptor metadata is never hand-edited.
- Adding a capability id is a contract version increment.

## Alternatives considered

- Checking that a named fixture file exists: rejected because an empty fixture could claim a capability into existence (as recorded in [conformance.md](../conformance.md) "Agent connector conformance").
