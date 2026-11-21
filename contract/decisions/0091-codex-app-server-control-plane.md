# ADR 0091: Codex app-server control-plane adapter

Date: 2026-11-20
Status: accepted
Contract version: [179.6.0](../CHANGELOG.md#17960---2026-11-20)
Supersedes: none
Contract impact: minor

## Context

Overlord-launched Codex objectives run as an interactive `codex <prompt>` terminal observed
through the Codex plugin's hooks (`connectors/adapters/codex/`, tier 1). Codex also ships
`codex app-server`, a JSON-RPC control plane. A spike on a live 0.170.0 server (coo:1325.gqfy,
`planning/feature-plans/codex-app-server-control-plane.md`) found it supports everything a tier-3
adapter needs: command and patch approvals as server-to-client requests (with the patch diff
before the approval), `turn/steer` into a running turn, `turn/interrupt`, and several clients per
thread where the first answer wins. It also found three hazards: the app server is experimental
and changes every release; a user config with `approvals_reviewer = "auto_review"` silently takes
approvals away from the client; and the Overlord Codex plugin's hooks fire inside app-server
threads, so a server started with objective scope would capture every edit twice.

## Decision

1. **A separate adapter.** `connectors/adapters/codex-app-server/` (adapter key
   `codex-app-server`, agent identifier `codex`, shape `controlPlane`). One descriptor has one
   integration shape, and a session channel already records its adapter key, so a Codex session
   says which surface it is on. The hooks adapter is unchanged and remains the surface for
   user-started Codex sessions.
2. **Same subcommand.** `ovld agent-session sidecar --agent codex-app-server` selects the
   transport by adapter key; no subcommand is added. It is experimental and refused unless
   `OVERLORD_CODEX_APP_SERVER=1` until launch integration (coo:1325.ke1y) mints the session
   channel it needs (launch mints none today, ADR 0065).
3. **A private server on an owner-only Unix socket.** One server per session, `unix://` in
   `~/.ovld/cx/` (0700; Codex keeps the real 0600 socket in its own 0700 directory). Never TCP,
   never the user's shared daemon socket, never remote control (the supervisor stops if remote
   control reports itself enabled). Same-user processes can connect, exactly as the Codex TUI
   can; that is accepted.
4. **Allowlisted server environment and one surface per session.** Commands inherit the server's
   environment, so it carries no user token, channel credential, mission or objective scope. It
   carries `OVERLORD_CONTROL_PLANE_SURFACE=codex-app-server`, and every Overlord callback hook
   exits before any work when that marker is set. A thread the supervisor drives is therefore
   never also captured or decided through hooks, which keeps the Codex
   `two-integration-surfaces-could-disagree` hazard closed by construction. Codex's per-thread
   `disabledPluginIds` would be the cleaner mechanism once it filters plugin capabilities; on
   0.170 it does not.
5. **Approvals stay with Overlord and the person.** Every thread is started or resumed with
   `approvalsReviewer: "user"`. An approval becomes a channel request card (commands through the
   core shell formatter; patches as repo-relative paths and line counts, never diff text). The
   answer is a decision Codex offered for that request: allow is `accept`; deny is `decline`, or
   `cancel` when `decline` is not offered. `acceptForSession` and policy amendments are never
   sent. Policy may answer only a plain `command` approval. Unknown server requests are refused
   with a JSON-RPC error so Codex never waits on Overlord for something it cannot answer.
6. **Concurrent answers.** When another client (an attached TUI) answers first, Codex reports
   `serverRequest/resolved` and the supervisor closes its card as resolved elsewhere without
   answering. After a reconnect the thread is resumed, Codex replays pending approvals, and a
   card whose approval was not replayed is closed the same way.
7. **Inject and interrupt.** A claimed input is `turn/steer` with the active turn as a
   precondition while a turn runs, otherwise `turn/start`; a refused precondition falls back to
   `turn/start`, never a retry of the same emit. Both report Delivered. Interrupt has no channel
   input kind or capability id: the supervisor interrupts the running turn when the channel stops
   honoring its credential (Overlord ended the session) or when it is signalled. A per-turn
   interrupt control from web or mobile would need a new input kind and capability id and is left
   to a later decision.
8. **Pinned surface and recorded evidence.** The adapter uses a pinned list of methods and
   notifications, refuses a server whose `initialize` user agent reports a version below the
   verified 0.170.0, and grades capabilities only from fixtures built on frames recorded from a
   live server. Decide and inject fixtures replay recorded frames through the shipped supervisor
   and assert the exact JSON-RPC bytes it sends.

## Consequences

- The connector matrix gains a tier-3 Codex row. Clients still gate on the live channel's
  capability snapshot, never on this catalog.
- Web and mobile cannot yet answer these cards or send instructions: the human answer route
  refuses permission answers and the human input route refuses new inputs for every adapter
  today (410 `session_controls_gone`). Enabling them for control-plane channels is a separate
  authorization decision.
- A human answer to a question is delivered through Latch into the terminal (ADR 0065). For a
  `codex-app-server` session that would also type into an attached TUI, so structured questions
  stay unverified and unclaimed until answer delivery is routed to the adapter.
- `thread/start` writes an implicit `trust_level = "trusted"` entry for the working directory into
  the user's Codex config. Recording and cleaning those entries belongs to launch integration.
- A supervisor killed with SIGKILL leaves its server running; reaping orphans belongs to launch
  integration.

## Alternatives considered

- **A `shape` variant of the `codex` descriptor:** rejected. A descriptor has one integration
  shape, and the capability rows differ completely between the two surfaces.
- **Connecting to the user's shared app-server daemon:** rejected. It is shared across every
  Codex session on the machine and can enable remote control.
- **Loopback `ws://` with a capability token as the default:** rejected in favour of a Unix
  socket, which needs no secret; it remains the fallback where Unix sockets are unavailable.
- **A new `control.interrupt` capability id now:** deferred. With no human surface to drive it,
  it would add a closed-vocabulary value nothing uses.
