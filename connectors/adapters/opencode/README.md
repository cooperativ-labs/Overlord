# OpenCode Connector

OpenCode integrates with Overlord as a **control plane** (Shape C), not as a callback harness.
There are no hook scripts here, and there is nothing for OpenCode itself to invoke.

Instead, Overlord runs a supervised sidecar next to the harness:

```
ovld agent-session sidecar --agent opencode --port <port>
```

The sidecar starts the OpenCode server bound to loopback with a per-launch
`OPENCODE_SERVER_PASSWORD`, subscribes to `/event`, normalizes each frame through the
connector-owned codec in [`codec/opencode.codec.yaml`](codec/opencode.codec.yaml), and pushes
the result to the channel it was launched with.

Three consequences are worth knowing before working on this adapter:

- **The control port is a credential.** Anything that can reach it can drive the agent. The port
  is never projected to the browser or mobile clients; remote surfaces talk to Overlord's own
  authenticated API, and Overlord talks to the port.
- **Reconnection replays.** A restarted sidecar re-reads `/permission` and `/question` and may
  re-emit frames its predecessor already delivered. This is safe because producer event ids are
  derived from content, so a replay deduplicates at the server rather than duplicating a card.
- **Answering is not holding.** Nothing blocks. A permission is a durable object on the bus that
  either the TUI or Overlord can resolve, which is why `terminal.concurrentAnswer` is a tracker
  here and a permanent `unsupported` for every callback harness.

Read [`CAPABILITIES.md`](CAPABILITIES.md) — generated from the fixture-backed descriptor — before
assuming anything else works.
