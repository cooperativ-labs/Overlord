# coo:826.mnds — Delivered missions on the Feed

Date: 2026-08-24
Contract: v120 → v121

## Goal

Put delivered missions back on the Feed as mission cards, limited to those
whose most recent delivery is within the last two weeks, and let the operator
scroll to load the next two-week window.

## What changed

`GET /api/activity-feed` now returns three kinds: `mission_run`,
`blocking_question`, and `mission_delivered`. A delivered mission uses the same
`ActivityFeedMissionItemDto` as a live one — keyed `mission:<missionId>`, full
objective list in mission-panel order — with `runState: 'delivered'` and empty
`activeObjectiveIds`. The card body is the latest delivery summary.

A mission that is still launching, executing, or pending delivery is never also
a delivered card. Window membership is the *latest* live delivery, so a
follow-up ship two days ago keeps a month-old first delivery on the first page.

Pagination is additive `?before=<ISO-8601 UTC>`. The first page is live work,
questions, and the last 14 days of delivered missions. Later pages omit live
work and questions and return only the next older 14-day delivered window.
`nextBefore` is that window's start when older delivered missions exist.

The SPA uses `useInfiniteQuery` and an intersection sentinel at the bottom of
the scroll pane. Realtime still invalidates `keys.activityFeed`; older pages
reload from the first window.

## Files

- `CONTRACT.md`, `contract/components.yaml` — v121
- `packages/contract/src/index.ts` — `mission_delivered`, `runState: 'delivered'`, `nextBefore`
- `backend/activity-feed.ts`, `backend/index.ts`
- `webapp/web/lib/api.ts`, `queries.ts`
- `webapp/web/components/activity-feed/*`
