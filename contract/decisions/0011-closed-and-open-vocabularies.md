# ADR 0011: Split controlled vocabularies into closed and open sets

- Date: 2026-06-09
- Status: accepted
- Contract version: 0.2-draft
- Supersedes: none
- Origin: foundational; first recorded in the contract at 0.2-draft (no change summary explains it), backfilled 2026-11

## Context

Several components read and write the same enumerated values (objective states, execution-request statuses, event types). Extensions need to add values of their own without breaking consumers that switch on the core set.

## Decision

Every controlled vocabulary is either closed or open, as listed in [conformance.md](../conformance.md) "Controlled Vocabularies". A closed vocabulary changes only with a contract version increment, and adding or removing a value is a breaking change. An open vocabulary admits namespaced values that an extension declares in its conformance manifest; promoting a value to core is a contract change.

## Consequences

- Consumers may treat a closed vocabulary as exhaustive.
- Extensions never introduce closed-vocabulary values; using one is a contract violation.

## Alternatives considered

Not recorded.
