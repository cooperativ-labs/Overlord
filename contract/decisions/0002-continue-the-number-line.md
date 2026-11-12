# ADR 0002: Continue the contract number line as Semantic Versioning

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

The contract version was a bare integer, last `168`. Code comments, commit
history, tickets and review notes say "contract v153" and similar in hundreds
of places. The new model uses strict Semantic Versioning so that the size of a
change can be computed from two versions.

## Decision

The number line continues. Version 168 is written `168.0.0` in
`contract/VERSION`; the baseline cut in phase 5 is the major increment to
`169.0.0`. Former integer version `N` means `N.0.0` wherever a comparison needs
it.

## Consequences

- Every existing reference to "contract vN" stays unambiguous.
- The first SemVer-classified change after the baseline is measured from
  `169.0.0`.
- Majors are large numbers; that carries no meaning beyond history.

## Alternatives considered

- Restart at `1.0.0`: rejected because every historical "vN" reference would
  become ambiguous between the old and new lines.
- Keep integers and add SemVer later: rejected because the release range check
  needs to classify impact from the version delta.
