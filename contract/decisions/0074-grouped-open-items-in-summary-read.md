# ADR 0074: Grouped open items in the mission summary read

Status: accepted
Date: 2026-11-17

## Decision

The summary read collapses open items that are the same thing into one row. Risks group by
normalized text. Suggestions group by normalized title, change, location and done-when.
The row is the newest record; older records are listed in an optional `duplicates` array.
Human actions are grouped by clients from the evidence list, which already carries every
record.

Stored identity does not change. Each record keeps its own `mission_items.id`, and closing
stays a per-id call with the existing rules and provenance. A client that closes a grouped
row calls close once per record and says so. The narrative publication guard and the
composer are untouched.

## Alternatives considered

- Close all duplicates in the server when one id is closed: changes the meaning of a close
  and its provenance, so it would be a major change. Rejected.
- Keep title-only suggestion dedupe: hides different work behind one title, and closing the
  row exposes the other. Rejected.
- Merge duplicates in storage: breaks agent-held ids (ADR 0068). Rejected.

## Consequences

Additive minor change to `MissionSummaryRiskDto` and `MissionSummarySuggestionDto`. Older
clients ignore `duplicates` and keep showing the newest record. Desktop shares the web app;
mobile must group the same way to avoid the closed-row-returns confusion.
