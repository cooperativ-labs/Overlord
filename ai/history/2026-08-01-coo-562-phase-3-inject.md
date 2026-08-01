# coo:562 Phase 3 — Inject (inbound follow-up instructions)

## Summary

Phase 3 lands honest inbound session-instruction delivery across Claude,
Cursor, OpenCode, and Pi. Adapters report only what actually happened:
`Delivered`, `Queued(turn-boundary)`, or `Unsupported`. An emitted input is
never automatically retried.

## Surfaces

- CLI: `ovld agent-session inbox --agent <key>` (third fixed hook action)
- CLI: `ovld inputs list|send` with honest `deliveryLabel`
- REST adapter: existing `/inputs/claim|emitted|acknowledged|failed` plus
  `deliveryOutcome` on emit
- REST human: `GET|POST /api/agent-session-inputs`, `POST /:id/cancel`
- Web: Mission panel Session instructions section shows delivery labels
- DB: additive `agent_session_inputs.delivery_outcome`

## Adapter paths

| Adapter | Path | Report |
| --- | --- | --- |
| Claude | `asyncRewake` (SessionStart/PostToolUse) exit 2 + stderr | Delivered |
| Claude | Stop `decision:block` + reason | Delivered |
| Cursor | stop `followup_message` | Queued (turn boundary) — never Delivered |
| OpenCode | sidecar `POST .../prompt_async` | Delivered |
| Pi | extension `sendUserMessage` then `--confirm` | Delivered after accept |

## Contract

Bumped to version `51`. Connector release `0.3.17`.

## Verification

- `yarn connectors:check` green (6 descriptors, fixtures executed)
- CLI agent-session tests 331 pass / 0 fail
- Core agent-session 16/16
- Backend agent-session routes 8/8
- `yarn typecheck:cli` clean; lint 0 errors
- Claude and OpenCode derive capability tier 3 (Conversational) from fixtures
