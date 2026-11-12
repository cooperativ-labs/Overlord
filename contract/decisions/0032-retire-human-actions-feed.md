# ADR 0032: Retire the cross-workspace Human Actions feed

- Date: 2026-09-28
- Status: accepted
- Contract version: 150
- Supersedes: none
- Origin: contract v150 (coo:1098), backfilled 2026-11

## Context

Versions 136, 138, 142 and 147 built a cross-workspace Human Actions rail with resolutions for reported human actions and deferred work.

## Decision

The rail and `GET /api/human-actions` are removed with their DTOs. Reported human actions remain in delivery reports and on the delivery card, without a done/dismissed state. Deferred-work resolutions move to `PUT`/`DELETE /api/deliveries/:deliveryId/deferred-work/:actionId/resolution`; a migration deletes resolutions that are not deferred-work ids.

## Consequences

- `human_action_resolutions` survives for deferred work only.
- The v136 to v147 rail statements are superseded.

## Alternatives considered

Not recorded.
