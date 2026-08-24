# Week 32, 2026 (3–9 Aug)

Consolidated from per-objective reports created this week.

## Inbox `dueDatetime` null validation (2026-08-03)

Saving an unassigned inbox mission failed with `dueDatetime must be a valid ISO-8601 datetime or null`. `validateInboxBody` coerced `undefined`/`null` to `null`, then rejected anything that was not a string. Fix: allow `null`; only reject non-null values that are not parseable ISO-8601. Also hide Run / agent controls when no project is selected (`NewMissionModal`, `QuickTaskBar`).

A follow-up rebuilt `backend/dist-server` (production still served the old check) and added `backend/inbox.test.ts` for omitted, null, valid, and invalid `dueDatetime`.

## CONTRACT.md changelog table (2026-08-03)

Restored changelog table formatting: escaped in-cell `|` for versions 51, 41, and 21; reduced the separator to two columns; repaired smashed spacing and stray italic markers.

## Promote button icon (2026-08-06)

Future-objective Promote in `DraftObjectiveToolbar` now uses Lucide `ArrowUpToLine` instead of `ArrowUpCircle`, matching the mobile SF Symbol `arrow.up.to.line` convention.
