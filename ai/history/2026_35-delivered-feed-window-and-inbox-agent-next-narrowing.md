# Week 35, 2026 (24–30 Aug)

Consolidated from per-objective reports created this week.

## coo:826.mnds — Delivered missions on the Feed (2026-08-24, contract v120→v121)

Put delivered missions back on `/feed` as mission cards, capped to those whose
most recent delivery is within the last two weeks, with scroll-to-load-older
pagination. `GET /api/activity-feed` gained a third kind, `mission_delivered`,
reusing `ActivityFeedMissionItemDto` with `runState: 'delivered'` and empty
`activeObjectiveIds`; window membership is keyed off the *latest* delivery, so
a recent follow-up ship keeps an old first delivery on the first page. A
mission still launching/executing/pending_delivery is never also shown as
delivered. Pagination is additive `?before=<ISO-8601 UTC>`, returning
`nextBefore` for the next 14-day window; the SPA drives it with
`useInfiniteQuery` and a bottom intersection sentinel.

## coo:844.rjhs — Inbox missions narrowed to agent-Next only (2026-08-24)

Removed the v117–v118 "recently created" union from `GET /api/inbox/missions`
entirely: the Inbox triage list now returns only agent-authored missions
still in status type `next` (contract v120). Unallocated profile-owned
captures are unaffected (`GET /api/inbox`). This is the final narrowing in
the same sequence as the two `coo:826` Inbox-missions objectives from the
prior week.

## coo:846 — Consolidate AI history older than one week (2026-08-24)

Established the recurring `ai/history` consolidation convention this file
follows: reports older than seven days are merged into ISO-week summaries
named `YYYY_WW-[title].md` (underscore between year and week, zero-padded),
grouped by the ISO week of the source file's birth date; files less than a
week old keep their original per-objective filenames.
