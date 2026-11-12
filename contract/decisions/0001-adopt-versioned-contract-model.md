# ADR 0001: Adopt a versioned contract with ADRs, a changelog and topic documents

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

Until version 168 the whole contract was one root `CONTRACT.md` of 4,034
lines. About three quarters of it were 71 "Version N Change Summary" sections
that served at once as changelog, decision record and specification; they were
out of order, versions 98, 100 and 102 were missing, and much binding detail
lived only in a summary. The version was a bare integer typed by hand in two
places and copied into every conformance manifest. No CI job ran the contract
checks. Clear Comply runs the same kind of contract with an entry point, topic
documents, one ADR per decision, a dated changelog, a `VERSION` file with a
single writer, and mechanical checks on every push.

## Decision

Overlord adopts that model under the existing `contract/` directory, which
already holds the machine-readable files and ships inside the CLI package:

- `contract/CONTRACT.md` is the entry point: scope, normative documents,
  precedence, versioning, change protocol and conformance.
- The specification lives in topic documents: `architecture.md`,
  `protocol.md`, `authorization.md`, `conformance.md` and `data/README.md`
  (moved from `database/docs/09-database-schema-contract.md`), with the
  existing machine-readable files and, from phase 4, `api/openapi.yaml`.
- `contract/VERSION` holds the strict Semantic Version and is written only by
  `yarn version:contract`.
- `contract/CHANGELOG.md` has one entry per version; `contract/decisions/`
  holds one ADR per decision.
- `yarn contract:check` (`scripts/check-contract.sh`) runs on every push and
  pull request; `scripts/contract-impact.mjs` checks a release range against
  the declared impact once the release gate exists (phase 5).
- The root `CONTRACT.md` is deleted rather than left as a stub, so there is one
  authority.

The move itself is a mechanical restructuring: text moved without rewording,
and no runtime or wire behaviour changed. The plan is
`planning/feature-plans/contract-adr-openapi-migration.md`.

## Consequences

- Every plan and material change summary declares `Contract impact:`.
- Contract-sensitive changes carry documentation, schema, test, changelog and
  version work in the same change.
- CI detects structural omissions; reviewers decide semantic impact.
- Readers and tools that used the root `CONTRACT.md` or its `Current version`
  line read `contract/CONTRACT.md` and `contract/VERSION` instead.
- Until phase 2 removes version-history phrasing and phase 3 reconciles the
  summaries, some binding text may still exist only in a provenance changelog
  entry; phase 3's backfill register closes that gap.

## Alternatives considered

- Keep the single file and only re-sort the summaries: rejected because it
  leaves changelog, decisions and specification entangled.
- Put the contract under `docs/` as Clear Comply does: rejected because `docs/`
  is the Astro site workspace and `contract/` already ships with the CLI.
- Leave a stub root `CONTRACT.md` pointing to the new location: rejected
  because a second file named as the contract invites edits to the wrong place.
