# ADR 0010: Code and contract land together

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

The former rule was "contract first": update `CONTRACT.md` before any code
that extends or conflicts with it. In practice the contract was sometimes
updated in one change and implemented in a later one, so the normative text
described behaviour that did not exist yet, and a version number named a
contract that no build implemented.

## Decision

A change that alters the contract carries, in the same change set, the
contract edits, the `yarn version:contract` increment, the changelog entry,
the implementation, tests, generated artifacts, migrations and any required
ADR. Every plan and material change summary declares
`Contract impact: none|patch|minor|major`. The contract may still be drafted
first in a plan; it is merged with the code.

## Consequences

- A contract version always describes code that exists in the same commit
  range.
- The `component-contract` skill and module `AGENTS.md` files describe this
  rule instead of "contract first".
- The release range check (phase 5) compares the declared impact with the
  `VERSION` delta.

## Alternatives considered

- Keep "contract first": rejected for the reason above.
- Let code lead and document afterwards: rejected because it permits untracked
  divergence.
