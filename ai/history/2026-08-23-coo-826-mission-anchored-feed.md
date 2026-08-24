# coo:826.kkg4 — Mission-anchored Feed

Date: 2026-08-23
Contract: v118 → v119

## Goal

Redesign the Feed page so each card is a **mission** rather than an objective,
listing that mission's objectives beneath it in the same order and with the same
icons the mission panel uses; put launching missions above executing ones; and
drop delivery cards entirely, leaving only launching/executing missions and
blocking questions.

## What the feed is now

`GET /api/activity-feed` returns two kinds: `mission_run` and
`blocking_question`. Deliveries are gone from the projection.

A mission with at least one `launching` / `executing` / `pending_delivery`
objective is a single `ActivityFeedMissionItemDto` keyed `mission:<missionId>` —
never one card per objective, even when a mission legally runs several
objectives in parallel. It carries:

- `runState` — `launching` or `executing`, driving both the badge and feed order.
- `objectives` — every objective of the mission as
  `ActivityFeedMissionObjectiveDto` (`state`, `autoAdvance`, `assignedAgent`),
  already sorted server-side.
- `activeObjectiveIds` — the objectives that are live right now.
- Chrome fields (agent, model, branch, `startedAt`, latest event) describing the
  mission's *primary* running objective: the launching one if there is one, else
  the oldest active one.

`items` is grouped rather than purely time-descending: launching missions, then
executing ones, then blocking questions, newest-first inside each group.

## Ordering and icons match the mission panel by construction

The backend orders each card's objective list with
`sortObjectivesForMissionDisplay` from `@overlord/automations` — the same
function `deriveObjectiveLifecycleView` uses to build the mission panel's list.
The two surfaces cannot drift, because there is one ordering rule and the SQL
does not sort.

`MissionRunCard` reuses the panel's icon vocabulary verbatim: spinning `Loader2`
for executing, slow-spinning `RefreshCw` for `pending_delivery` (a refresh mark,
not a warning), emerald `CheckCircle2` for complete, sky `Rocket` for launching,
dim `Circle` otherwise. Live rows carry the identical emerald shimmer sweep
`ObjectiveCollapsibleItem` uses.

## Files

Backend / contract:

- `backend/activity-feed.ts` — mission-grouped projection: `loadRuns` still reads
  at objective level (a mission can run several at once), then groups by mission,
  caps on *cards*, picks the primary run, and loads each mission's full objective
  list in one bounded query. Delivery loading removed.
- `packages/contract/src/index.ts` — `ActivityFeedMissionItemDto` and
  `ActivityFeedMissionObjectiveDto` replace `ActivityFeedRunItemDto`,
  `ActivityFeedDeliveryItemDto`, and `ActivityFeedQueuedObjectiveDto`.
- `CONTRACT.md`, `contract/components.yaml` — v119 with a breaking-change summary.

Webapp:

- `webapp/web/components/activity-feed/MissionRunCard.tsx` (new) — the mission
  card plus its objective list.
- `ObjectiveRunCard.tsx`, `DeliveryFeedCard.tsx` — deleted.
- `ActivityFeed.tsx`, `ActivityFeedCardChrome.tsx`, `activity-feed-model.ts` —
  two kinds instead of three; `identity="mission"` context line; dead
  `delivered` badge tone removed.

Docs:

- `planning/feature-plans/inbox-activity-feed.md` — marked superseded in part, so
  the v84 DTO sketch is not mistaken for the current spec.

## Verification

- `yarn typecheck:backend`, `yarn typecheck:webapp` — clean.
- `backend/activity-feed.test.ts` + `backend/inbox-missions.test.ts` — 17/17 pass,
  including "one mission running two objectives is still a single card", "a
  mission card lists every objective in mission-panel display order", "a
  launching objective makes its mission lead the feed", and "deliveries never
  appear on the feed".
- `yarn test:webapp` — 193/193 pass.
- `yarn check:conformance-versions` — passes at contract version 119.
- `yarn lint` — 0 errors; no warnings in any touched file.

## Notes

The v119 bump is genuinely breaking for any client reading `objective_run` or
`delivery` items from `/api/activity-feed`. Finished work is still read through
`GET /api/missions/:id/deliveries`, which is unchanged — the delivery data was
removed from the feed, not from the product.
