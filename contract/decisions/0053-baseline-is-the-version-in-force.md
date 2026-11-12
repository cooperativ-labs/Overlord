# ADR 0053: The production baseline is the version in force when phase 5 finished

- Date: 2026-11-12
- Status: accepted
- Contract version: 169.2.1
- Supersedes: none
- Amends: [ADR 0002](0002-continue-the-number-line.md)

## Context

ADR 0002 continued the integer number line as Semantic Versioning and said the
baseline cut in phase 5 would be the major increment to `169.0.0`. Before phase 5 ran,
a breaking change (ADR 0049) took the contract to `169.0.0`, and phases 4c and 4d took
it to `169.2.0`. Cutting another major only to mark the baseline would claim a breaking
change that did not happen and force every conformance manifest in two repositories to
be restamped for nothing.

## Decision

The production baseline is the contract version in force when phase 5 of the migration
finished: `169.2.1`, the patch increment that introduced the release gate (ADR 0052).
No major increment marks the baseline. The rest of ADR 0002 stands: the number line
continues, and former integer version `N` means `N.0.0`.

Every conformance manifest in this repository and in `OverlordMobile` is restamped to
`169.2.1`. The baseline record, its candidate SHA and approvals are in
[releases/169.2.1/](../releases/169.2.1/README.md).

## Consequences

- A major increment keeps meaning only a breaking change.
- The first release's range runs from `169.2.0` to `169.2.1` and is declared `patch`.
- References to "the `169.0.0` baseline" in the migration plan are superseded by this
  record.

## Alternatives considered

- Bump to `170.0.0` for the baseline as the plan reserved: rejected because nothing
  breaks, and a major would misstate compatibility.
- Declare `169.0.0` the baseline retroactively: rejected because `169.0.0` was never
  released through the gate and the phase 4 changes after it are part of what is
  released.
