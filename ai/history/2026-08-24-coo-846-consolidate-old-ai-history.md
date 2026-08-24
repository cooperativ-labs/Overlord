# coo:846 — Consolidate AI history older than one week

## Summary

Reports in `ai/history` older than seven days (created before 2026-08-17) were
merged into ISO-week summaries named `YYYY_WW-[title].md`. Files from 17 Aug
2026 onward keep their original titles.

## Weekly files

| File | Sources |
| --- | --- |
| `2026_26-client-checkout-bridge-verification.md` | checkout-bridge verification |
| `2026_28-resource-binding-bundle-size-and-calendar.md` | resource-binding review/E2E, bundle size, calendar phase 2–3 rationales |
| `2026_29-runner-status-unavailable-fix.md` | runner status UI |
| `2026_31-artifacts-agent-session-and-shared-state.md` | artifacts, checkpoints, shared state, agent-session inject/review |
| `2026_32-inbox-due-datetime-and-ui-fixes.md` | inbox dueDatetime, CONTRACT changelog, promote icon |
| `2026_33-touched-files-hook-and-latch-locale.md` | touched-files hook cwd, Latch UTF-8 locale |

## Assumptions

- Week numbers are ISO weeks of file birth time (zero-padded).
- Filename uses underscore between year and week (`2026_26-…`), matching the
  stated `[year]_[week number]-[summary title].md` pattern.
