# Latch engine Overlord migration (coo:707, objective 3)

Overlord keeps the agent plug-in surface and consumes Latch for harness
observation. Channel 1 (protocol attach, artifacts, shared state, delivery)
must work with Latch uninstalled. Mechanical observe/decide/inject moves off
Overlord connectors onto `latch events` and, when available, `latch send --resolve`.

See `planning/ENGINE_PLAN.md` and `planning/OVERLORD_INTEGRATION.md` in the
sibling Latch checkout.

## Split

1. **Agent → Overlord** — plug-ins, MCP, protocol. No Latch dependency.
2. **Harness → Latch** — turns, tools, `awaiting_input`, exit via `latch events`.
3. **Human → Agent** — messages/keys/resolve via Latch PTY (`latch send` is Phase 3).

Binding is `ovld protocol attach`. Latch turns without attach are surfaced as
`observation.unattached`. Agent assertion is the record; Latch observation is
presentation.

## Overlord changes

- Launch no longer mints Agent Session Exchange channels.
- Runner and mission ingest persist `latch events` onto
  `execution_requests.metadata_json.providerSession.observation`.
- Human ASE resolve/enqueue/release/cancel return 410. GET omits open/queued rows.
- Mission panel shows Latch pending input and unattached warnings on terminal
  session cards. Session-instruction controls are removed.
- Connector hooks keep Channel 1 follow-up and touched-file attribution.
  Mechanical ASE observe/decide/inject registrations are uninstalled.
