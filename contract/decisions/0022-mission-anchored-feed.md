# ADR 0022: The activity feed is a projection of missions

- Date: 2026-08-24
- Status: accepted
- Contract version: 119
- Supersedes: none
- Origin: contract v119 (coo:826), backfilled 2026-11

## Context

The feed listed objective runs and deliveries separately, so one mission appeared many times.

## Decision

`GET /api/activity-feed` projects missions: one `ActivityFeedMissionItemDto` per mission with live work, carrying its objectives in mission-panel order and `activeObjectiveIds`. The `objective_run` and `delivery` item kinds and their DTOs are retired. Later versions add `mission_delivered` cards (v121); deliveries are otherwise read through `GET /api/missions/:id/deliveries`.

## Consequences

- The change was breaking for feed consumers.

## Alternatives considered

Not recorded.
