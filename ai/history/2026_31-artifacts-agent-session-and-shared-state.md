# Week 31, 2026 (27 Jul–2 Aug)

Consolidated from per-objective reports created this week.

## Update artifacts via API, MCP, and CLI (coo:518, 2026-07-29)

Agents can revise an existing mission artifact in place. Protocol `ovld protocol update-artifact` and MCP `overlord_update_artifact` call the existing `updateArtifact` service (REST `PATCH` unchanged). Required: mission id, artifact id, expected revision; optional label / contentText / externalUrl. No session key required. Stale revisions still 409. Contract v37; connectors 0.3.9. Product, connector, and marketing docs updated.

## Mid-turn artifact create (coo:564, 2026-08-01)

Agents can create artifacts without delivering: REST `POST /api/missions/:id/artifacts`, Protocol `add-artifact`, MCP `overlord_add_artifact`. `delivery_id` stays null for mid-turn creates. Contract v46; connectors 0.3.11.

## Remove checkpoints from docs (coo:565, 2026-08-01)

Docs-only: attach/deliver now document the VCS-baseline model only. Removed `refs/overlord/checkpoints`, `--skip-checkpoint`, and `ovld protocol revert` on checkpoints from product, connector, and internal docs. Connectors 0.3.14.

## Display shared mission state (coo:566, 2026-08-01)

Expose `shared_context_entries` in the mission panel (view/edit/add) plus REST `GET`/`PUT /api/missions/:id/context`. Protocol `writeSharedContext` emits entity changes for realtime. Contract v50.

## Agent-session inject (coo:562 Phase 3, 2026-08-01)

Honest inbound session-instruction delivery for Claude, Cursor, OpenCode, and Pi: `Delivered`, `Queued(turn-boundary)`, or `Unsupported`. Cursor stop `followup_message` is always queued at turn boundary. Additive `agent_session_inputs.delivery_outcome`. Contract v51; connectors 0.3.17.

## Agent-session module review (coo:562 Objective 7, 2026-08-01)

**0 critical, 4 high, 3 medium.** Corrected connector-owned decision codecs (native dialects moved out of CLI into connector `codec/`), honest callback deadlines (80% of harness timeout), and docs drift.

High still open at the time of the review: channel sentinel never started; server request/channel sweeps have no production scheduler; effective live capabilities neither computed nor trusted; Phase 2 web decision surface absent. Medium: unused presence policy, missing push diagnostics, incomplete Pi/OpenCode product wiring.
