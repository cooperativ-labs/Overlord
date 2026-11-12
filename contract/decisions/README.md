# Architecture Decision Records

ADRs explain why consequential contract decisions were made. They supplement
the current contract documents but do not silently override them
([CONTRACT.md](../CONTRACT.md) section 3).

## Required format

Each ADR is a file `NNNN-short-title.md` with a four-digit identifier that is
never reused. It starts with `# ADR NNNN: Title` and a header list:

- `Date:` the date the decision was made (ISO 8601);
- `Status:` one of `proposed`, `accepted`, `superseded`, or `rejected`;
- `Contract version:` the contract version current when it was accepted;
- `Supersedes:` the ADRs it replaces, or `none`; a superseded ADR gains
  `Superseded by:`; and
- `Origin:` for a backfilled record only, the contract version and ticket it
  records and when it was backfilled, for example
  `Origin: contract v153 (coo:1042), backfilled 2026-11` (ADR 0005).

The body has the sections **Context**, **Decision**, **Consequences**, and
**Alternatives considered**. A backfilled record whose source does not record
alternatives says "not recorded" rather than inventing them.

An accepted ADR is required for changes to architecture, foundational
technology, component or service boundaries, authentication, authorization,
workspace or organization isolation, persistent data meaning, migration
semantics, or other system-wide security properties, and for retiring a
surface. Purely additive changes are recorded in the changelog only (ADR 0004).

Add every new record to the index below; `yarn contract:check` fails when a
record and the index disagree.

## Index

- [0001 — Adopt a versioned contract with ADRs, a changelog and topic documents](0001-adopt-versioned-contract-model.md)
- [0002 — Continue the contract number line as Semantic Versioning](0002-continue-the-number-line.md)
- [0003 — Keep the former change summaries verbatim as non-normative changelog entries](0003-changelog-keeps-summaries-verbatim.md)
- [0004 — Backfill ADRs by decision, not by version](0004-backfill-adrs-by-decision.md)
- [0005 — Mark backfilled ADRs with their origin](0005-mark-backfilled-adrs.md)
- [0006 — A hand-authored OpenAPI description is the source of truth for REST](0006-openapi-source-of-truth.md)
- [0007 — Keep REST paths; no `/api/v1` move](0007-no-api-path-move.md)
- [0008 — OpenAPI covers REST only](0008-openapi-covers-rest-only.md)
- [0009 — Conformance manifests pin the major version](0009-manifests-pin-major-version.md)
- [0010 — Code and contract land together](0010-code-and-contract-land-together.md)
