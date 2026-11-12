# ADR 0014: Pin duplicated deterministic algorithms with golden vectors

- Date: 2026-06-22
- Status: accepted
- Contract version: 0.29-draft
- Supersedes: none
- Origin: foundational; first recorded in the contract at 0.29-draft (no change summary explains it), backfilled 2026-11

## Context

The per-mission branch/worktree planning algorithm must produce identical results in the runner (which prepares the branch) and the backend (which predicts it for REST).

## Decision

Each component keeps its own copy of such an algorithm, and both copies are tested against one committed fixture of golden input/output vectors ([branch-planning-vectors.json](../branch-planning-vectors.json)). Neither component imports the other's copy. Changing the algorithm changes both copies and the fixture together and is a contract version increment.

## Consequences

- The fixture is a stable interface; editing it is a `major` change.
- CI runs both test suites against the same vectors.

## Alternatives considered

- Sharing a runtime package between the components: rejected because it couples the components' build and publish graphs (as recorded in [architecture.md](../architecture.md) "Shared Deterministic Algorithms").
