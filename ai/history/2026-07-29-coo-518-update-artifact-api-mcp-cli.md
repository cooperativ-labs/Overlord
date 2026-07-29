# coo:518 — Update Artifacts via API, MCP, and CLI

## Summary

Agents can now revise an existing mission artifact in place through Protocol,
MCP, and CLI. REST `PATCH /api/missions/:id/artifacts/:artifactId` already
existed (coo:449 / contract v30); this work adds the agent-facing surfaces that
call the same `updateArtifact` service.

## Surfaces

- Protocol: `ovld protocol update-artifact` → `POST /api/protocol/update-artifact`
- MCP: `overlord_update_artifact` (hosted + codex/cursor/antigravity shims)
- REST: unchanged `PATCH` path

Required inputs: mission id, artifact id, expected revision. Optional editable
fields: label, contentText, externalUrl (at least one required). No session key
is required so a later objective or follow-up can revise a plan created earlier.
Stale revisions still return 409.

## Docs follow-up

Also updated:

- Product docs (`docs.ovld.ai`): context-and-artifacts, agent-protocol, MCP,
  CLI reference
- Connector core reference: `context.md`, `mcp.md`, `SKILL.md` (connector 0.3.9)
- Marketing site (`overlord-website`): protocol/artifacts, context-and-artifacts,
  CLI reference, MCP server, agent rules; new agent-doc
  `docs/public/mission-artifacts.md` registered in `agent-docs-manifest.json`
  so `/llms.txt` and `/llms-full.txt` include it

## Contract

Bumped to version `37`. Connectors currently at `0.3.9`.
