# ADR 0042: Retire the My Missions aggregate board

- Date: 2026-10-08
- Status: accepted
- Contract version: 160
- Supersedes: none
- Origin: contract v160 (coo:1134), backfilled 2026-11

## Context

My Missions duplicated project boards across workspaces with a personal ordering table (v96 had keyed it on status type).

## Decision

The board, `GET /api/workspace/my-missions`, `PATCH /api/workspace/my-missions/order`, their DTOs, the `MY_MISSIONS_*` vocabulary and the `my_mission_positions` table are removed; Feed is the landing page. Cross-project personal interleaving has no replacement.

## Consequences

- The migration discards personal board order only.
- v96 is superseded.

## Alternatives considered

Not recorded.
