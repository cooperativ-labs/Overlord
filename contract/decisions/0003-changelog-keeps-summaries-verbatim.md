# ADR 0003: Keep the former change summaries verbatim as non-normative changelog entries

- Date: 2026-11-12
- Status: accepted
- Contract version: 168.0.0
- Supersedes: none

## Context

The 71 "Version N Change Summary" sections of the former root `CONTRACT.md`
(versions 95–168, without 98, 100 and 102) held changelog, rationale and
specification together, and were out of order. Rewriting them risks losing or
altering binding detail; deleting them loses provenance.

## Decision

Each summary moves verbatim into `contract/CHANGELOG.md` as a `## [N]` entry,
sorted newest first, by a script whose output was checked line for line
against the original. A marked boundary states that entries at or below `168`
are provenance and are not normative: where one disagrees with a current
contract document, the document wins. Versions 1–94 are not recovered; they
remain in git history.

## Consequences

- Nothing is lost and nothing is rewritten.
- Binding statements that exist only in a provenance entry stop being
  normative by this boundary; phase 3 of the migration plan finds them, moves
  each into a topic document or an ADR, and records the result in a backfill
  register.
- Relative paths and section names inside provenance entries are as written at
  the time and may no longer resolve.

## Alternatives considered

- Rewrite the summaries into a uniform changelog format: rejected because it
  invites silent change of meaning.
- Keep the summaries normative: rejected because it would leave the topic
  documents incomplete by design.
- Drop the summaries and rely on git history: rejected because the history of a
  4,000-line file is hard to read and the summaries are the best record of why.
