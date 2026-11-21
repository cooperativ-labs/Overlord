# ADR 0092: Launch Codex objectives through the app-server control plane

Date: 2026-11-20
Status: accepted
Contract version: [179.7.0](../CHANGELOG.md#17970---2026-11-20)
Supersedes: none (amends ADR 0065 decision 1 and ADR 0091 decision 2 for control-plane launches)
Contract impact: minor

## Context

ADR 0091 added the `codex-app-server` control-plane adapter: a supervisor that drives a private
`codex app-server` and posts events and approval cards through a session channel. Nothing launched
it, because launch mints no channel (ADR 0065 decision 1) and the supervisor cannot post without a
credential; its first turn starts before the agent attaches. Overlord-launched Codex objectives
therefore still ran as an interactive `codex <prompt>` terminal observed through hooks.

The spike (coo:1325.gqfy) and a live run on 0.170 (coo:1325.ke1y) also showed what the launch must
handle: the Codex TUI can attach to a running thread with `codex --remote unix://… resume <id>`
once the thread's rollout exists; `thread/start` writes an implicit `trust_level = "trusted"` entry
for the working directory into the user's Codex config; a server that dies mid-turn leaves its turn
interrupted; and a supervisor killed with SIGKILL leaves its server running.

## Decision

1. **Launch mints a channel for control-plane launches only.**
   `POST /api/objectives/{id}/session-channels` (permission `session:attach`, objective's own
   workspace) creates a `preparing` channel with `launch_kind = 'control_plane'` and a scoped
   credential, bound to the objective, its mission and, when given, the execution request (which
   must be the objective's) and target. The adapter set is closed: only `codex-app-server` (agent
   identifier `codex`); any other key answers 400 `adapter_not_control_plane`. The credential is
   returned once and staged in the owner-only credential cache, never argv or a launch script.
   Every other launch still mints no channel, and protocol attach is still the binding
   declaration: attach inside the thread carries no channel id and binds this channel by objective
   (`findBindableChannelForMission`). Attach's `unknown` agent placeholder no longer overwrites a
   channel's known agent identifier.
2. **A harness mode, off unless chosen.** Agent launch config gains optional `harnessMode`
   (`hooks` | `appServer`; absent means `hooks`), per user and machine (Settings → Terminal & IDE).
   A launch uses app-server mode for `codex` when that setting, the launching process's
   `OVERLORD_CODEX_APP_SERVER=1`, or the project's launch env var of that name selects it. It falls
   back to the terminal launch, with a warning, when Codex is missing or older than 0.170.0, the
   launch has no objective, or minting fails. User-started Codex sessions always use hooks.
3. **The supervisor owns the session; the terminal only attaches.** Launch starts
   `ovld agent-session sidecar --agent codex-app-server` detached (with
   `OVERLORD_CODEX_APP_SERVER=1`), after running the project's pre-launch commands. It spawns one
   private server per session on the owner-only Unix socket of ADR 0091, starts a persistent thread
   with the launch's model, effort, approval policy and sandbox (`approvalsReviewer` is always
   `user`), and sends the objective prompt as the first turn. Codex launch flags that set the
   approval policy or sandbox become thread settings; other flags and the pre-command are reported
   as ignored. The visible terminal (a launcher window or Latch) runs `ovld agent-session attach`,
   which waits for the thread's rollout and runs `codex --remote unix://<socket> resume <thread>`.
   A runner with no terminal needs none; a person can attach later. `codex exec --remote` is not
   used: the supervisor already speaks the protocol.
4. **Lifecycle.** The supervisor writes an owner-only state file (socket, thread, pids, trust entry)
   next to the socket. A crashed server is respawned up to three times and the thread resumed;
   when no turn is then running, one continuation turn is sent so the objective does not stall. The
   channel heartbeat response reports `objectiveState` and `deliveryState`: the supervisor stops
   when the objective is `complete` or `deleted`, or when the session has `delivered` and the thread
   has been idle for 15 minutes. On every exit it interrupts a running turn, ends the channel, stops
   the server, and removes its state and credential cache. Orphaned servers (supervisor gone) are
   reaped at the next supervisor start and by `ovld doctor`, after checking the pid still belongs
   to a Codex app server.
5. **Trust.** Implicit trust on `thread/start` is accepted as the equivalent of `--trust` for an
   Overlord working directory. The supervisor records whether an entry existed before the thread
   started and, if the start added one, removes exactly that table when the session ends — only
   while it still holds nothing but `trust_level = "trusted"`. An entry the person wrote, an
   explicit `untrusted`, or a table with other keys is never touched.
6. **Server environment.** The allowlist of ADR 0091 also passes `OVERLORD_BACKEND_URL` and
   `OVLD_HOME`, so the agent's own `ovld` reaches the same backend and data directory. Neither is a
   credential or scope.
7. **Redaction.** Protocol session keys (`sess_…`) are credential-shaped material for the shared
   summary redaction: the agent's own `ovld protocol … --session-key` commands are shell-tool
   summaries, and a live run stored one in full.

## Consequences

- Overlord-launched Codex objectives can run end to end through the app server behind the setting
  (verified live on 0.170.0 against a Local backend: mint, attach binding, events, delivery,
  self-stop, crash respawn and continuation, TUI attach, approval answered in the TUI closing the
  card as resolved elsewhere, trust cleanup).
- Web and mobile still cannot answer permission cards or send instructions to these sessions
  (ADR 0091 consequences); the attached TUI is the place to answer.
- A launch whose supervisor fails before its first heartbeat leaves its channel `preparing` until
  the lease sweep marks it `lost`.
- An app-server thread's commands run under Codex's sandbox; a workspace-write sandbox without
  network access can block the agent's own `ovld` calls, which then surface as approval requests.
- Doctor reports which Codex sessions on the machine run in app-server mode; all others are hooks.

## Alternatives considered

- **Mint a channel for every launch:** rejected. It reverses ADR 0065 for adapters that do not need
  a credential and would hand out credentials nothing uses.
- **Reuse one server per execution target:** deferred. One server per session keeps a crash, the
  environment and the trust entry scoped to one objective.
- **Run the supervisor from the terminal command:** rejected. The session must survive the terminal
  closing, and a runner may have no terminal.
- **`codex exec --remote` for runners:** not needed; it rejects agent config overrides, and the
  supervisor already drives the thread.
- **Remove trust entries through `config/batchWrite`:** deferred. It is not in the pinned surface;
  a guarded line-level edit after the server stops has no server to race.
