# coo:757.bzsh — Fix agent data display on activity feed cards

## Summary

Running and Delivery cards in the Inbox live feed were showing the literal label
`unknown` next to a model id (e.g. `unknown · cursor-grok-4.6`). The protocol
defaults a missing `--agent` to the sentinel string `unknown`, and the feed
preferred `session.agent_identifier ?? assigned_agent`, so the sentinel permanently
hid a real assigned agent. Cards also lacked the agent-authored provenance sparkle
used elsewhere on board/list surfaces.

## Changes

- **Contract v86**: `ActivityFeedItemBaseDto` additively carries `createdByKind` /
  `createdByAgent` from the underlying objective.
- **Backend** (`activity-feed.ts`): treat `unknown` as absent; fall back to
  `assigned_agent`. Project objective provenance on every feed item.
- **Web**: `normalizeAgentKey` / `getAgentIcon` ignore `unknown` and fold aliases;
  run/delivery/question cards render connector icon + model via
  `ActivityFeedAgentLine`, and place `ObjectiveOriginMark` in the top-right corner.

## Verification

- `backend/activity-feed.test.ts` — 9/9 pass (including unknown-fallback and
  provenance cases)
- webapp activity-feed model + mission-origin tests — 14/14 pass
- Typecheck clean on touched activity-feed surfaces after `yarn workspace
  @overlord/contract build`
