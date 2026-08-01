# coo:564 — Enable artifact modification during turns

## Summary

Agents can create mission artifacts mid-turn without delivering, and continue to
revise existing artifacts in place. Delivery may still attach additional
artifacts; it is no longer the only create path.

## Surfaces

- REST: `POST /api/missions/:id/artifacts` → `createArtifact` (`artifact:create`)
- Protocol: `ovld protocol add-artifact` → `POST /api/protocol/add-artifact`
- MCP: `overlord_add_artifact` (hosted + codex/cursor/antigravity connector shims)
- Existing revise path unchanged: `update-artifact` / `overlord_update_artifact` /
  `PATCH /api/missions/:id/artifacts/:artifactId`

Required create inputs: mission id, type, label, plus at least one of contentText
or externalUrl. Optional session key (auto-injected from the attach cache when
present) stamps session/objective provenance. `delivery_id` stays null for
mid-turn creates.

## Agent instructions

Connector core (`connectors/core/overlord-mission`) and product docs now tell
agents to use `add-artifact` during a turn and `update-artifact` to revise.
Connector release bumped to `0.3.11`.

## Contract

Bumped to version `46`.
