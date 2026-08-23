# coo:826.yhg8 — Inbox recent + agent-Next missions

## Summary

The Inbox column now shows unallocated captures **and** a triage list of
missions: recently created (past 7 days) plus any agent-authored mission still
in status type `Next`. Live activity remains on `/feed`.

## Changes

- **Contract v117**: additive `GET /api/inbox/missions` → `InboxMissionsResponse`
  / `InboxMissionDto` (`MissionDto` + project chrome + `reasons`).
- **Backend**: `listInboxMissions()` merges the two projections with
  `mission:read` fan-out across the active organization; tests in
  `backend/inbox-missions.test.ts`.
- **Webapp**: Inbox page renders a Missions subsection with `MissionCard`;
  realtime invalidation includes `keys.inboxMissions`.

## Assumptions

- "Recently created" = rolling 7-day window, capped and merged with agent-Next.
- Opening a triage card navigates to the project board mission panel (existing
  `MissionCard` behavior).
