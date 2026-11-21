# Codex app-server Connector

The `codex-app-server` adapter drives Codex through its **control plane**: Overlord runs a
private `codex app-server` and is a JSON-RPC client of it. There are no hook scripts here and
nothing is installed into Codex. User-started Codex sessions keep the hooks adapter in
[`../codex/`](../codex/README.md).

> **Experimental, off unless chosen.** Overlord-launched Codex objectives run through this
> adapter in **app-server mode** (ADR 0092); otherwise they use `codex <prompt>` and the hooks
> adapter. Needs Codex 0.170.0 or later (verified end to end on 0.171.0), macOS or Linux.

## Turning it on

Any one of these selects app-server mode for a Codex launch:

- **Per user and machine:** Settings → Terminal & IDE → Codex → *Run through the Codex app server
  (experimental)* (the agent launch config's `harnessMode: appServer`).
- **Per project:** a project launch env var `OVERLORD_CODEX_APP_SERVER=1`.
- **Per runner or shell:** `OVERLORD_CODEX_APP_SERVER=1` in the environment of `ovld runner` or
  `ovld launch`.

When Codex is missing or older than 0.170.0, the objective has no id, or the backend cannot mint
the channel, the launch falls back to the terminal (hooks) with a warning.

The thread's approval policy and sandbox come from the Codex launch flags: the flags saved in
Settings → Terminal & IDE for runner launches, and `--flag` arguments for a direct `ovld launch`
(for example `ovld launch codex --objective-id <ref> --flag=--ask-for-approval=untrusted`).
Without them the thread runs `on-request` with a `workspace-write` sandbox, where Codex runs
commands and edits inside the working directory without asking, so few or no cards appear.

## What a launch does

0. Checks the objective's model and effort against the installation's live `model/list` (cached
   10 minutes, read through a short-lived stdio app server) and stops with the available models
   when Codex does not list them. This applies to terminal (hooks) launches too, and is skipped
   when Codex cannot be asked. `ovld models codex --sync` (and the runner, at start and every 6
   hours) records the same list as the workspace's Codex models, so the picker offers them.
1. Mints a session channel for the objective (`POST /api/objectives/{id}/session-channels`,
   `launch_kind = control_plane`) and stages its credential in the owner-only cache.
2. Runs the project's pre-launch commands, then starts the supervisor detached:

   ```
   ovld agent-session sidecar --agent codex-app-server --prompt-file <context> \
     --working-directory <dir> [--model <m>] [--effort <e>] [--approval-policy <p>] \
     [--sandbox <s>] [--codex-bin <path>]
   ```

   Codex launch flags that set the approval policy or sandbox (`-a`, `-s`, `--full-auto`,
   `--dangerously-bypass-approvals-and-sandbox`) become thread settings; other flags and the
   pre-command are ignored with a warning, because the server is started by Overlord, not by the
   terminal.
3. Opens the terminal (a launcher window or Latch) on `ovld agent-session attach`, which waits for
   the thread and runs `codex --remote unix://<socket> resume <thread>`. A runner with no terminal
   needs none.

The agent then attaches with `ovld protocol attach` from inside the thread; attach binds the
launch's channel by objective.

## Answering approvals

Codex's command and patch approvals (and single questions) become Overlord cards, and Codex holds
the agent until someone answers:

- **In Overlord** (web app; `ovld`): the card shows the command or the files and line counts, with
  **Allow once** and **Deny**. Only the member who launched the session can answer an approval; for
  anyone else the card is read-only (ADR 0094). After an answer the card shows it and whether the
  supervisor has applied it. The mobile app shows these cards read-only for now.
- **In the attached TUI**: answer the prompt as usual.

The first answer wins; the other side's card or prompt closes. Allow is always *once*: standing
grants are never sent. Follow-ups, steering and interrupts are typed in the TUI: Overlord's
session-input route is still closed for every agent.

## Watching and answering in a terminal

```
ovld agent-session attach [--objective-id <ref>] [--channel-id <id>] [--wait-ms <ms>]
```

opens the Codex TUI on a running session on this machine. It shows pending approvals; the first
answer (the TUI's or Overlord's) wins, and Overlord's card then closes as resolved elsewhere.
Closing the TUI leaves the session running; attach again to come back. `ovld doctor`
(`codex-harness-mode`) lists the running app-server sessions and their attach commands; every
other Codex session uses the hooks adapter.

With the optional Codex status line (`ovld agent-setup codex --status-line`, Codex 0.171+), the
attached TUI's footer shows the session's mission and objective. The private server runs the
Overlord plugin's MCP server in its allowlisted environment, which has no launch binding, so the
sidecar records the session's thread in the native-session index when the thread is ready and
removes the entry when it exits.

## Lifecycle

- One private server per session. The supervisor writes an owner-only state file next to the
  socket in `~/.ovld/cx/`.
- A crashed server is respawned (at most three times) and the thread resumed; if no turn is then
  running, one continuation turn asks the agent to carry on.
- The supervisor stops when the objective is complete or deleted, or when the session has
  delivered and the thread has been idle for 15 minutes; on every exit it interrupts a running
  turn, ends the channel, stops the server and removes its state.
- A supervisor killed outright cannot leave its server working: a small watchdog started with the
  server ends the server's process group as soon as the supervisor's pid is gone. The next
  supervisor start and `ovld doctor` reap anything left behind.
- **Folder trust.** `thread/start` writes `trust_level = "trusted"` for the working directory into
  `~/.codex/config.toml`, which is what lets a fresh worktree load its project config and the
  Overlord MCP server and plugin. The supervisor removes exactly that entry when the session ends,
  and never an entry you wrote, an explicit `untrusted`, or a table with other keys.

## Security model

Reviewed in [`security-audits/2026-11-21.md`](../../../security-audits/2026-11-21.md).

- **Listening surface.** One private server per session, on a Unix socket in `~/.ovld/cx/`
  (created `0700`; the supervisor refuses a directory that is a symlink, group- or
  world-accessible, or owned by someone else). Codex keeps the real `0600` socket in its own `0700`
  directory, and the supervisor connects only after checking that the socket and its directory
  belong to you and are not group- or world-writable. There is no TCP listener, and Overlord
  never connects to your shared Codex daemon.
  No thread is started until the server reports remote control `disabled`, and the session stops
  if it ever reports anything else.
- **Who can connect.** Processes running as your OS user, exactly as with the Codex TUI. That
  includes commands the agent runs: Codex's sandbox lets them read your files, so with network
  access they could read your `ovld` login and answer the session's own cards. Run app-server
  mode, like Codex itself, only for work you would let run as you.
- **Secrets.** No token is ever in a command line. The channel credential is staged in an
  owner-only cache and read by the supervisor; the supervisor's environment carries neither it
  nor your user token, and the server gets an allowlisted environment (no Overlord credential or
  objective scope) that the agent's commands inherit. The state file holds paths, pids and the
  thread id only. Codex's own login stays in `CODEX_HOME`; account email and ids never leave the
  machine.
- **Approvals.** Every thread is started and resumed with `approvalsReviewer: "user"`, so an
  `auto_review` setting cannot take approvals away from you. Only the launching member can answer
  an approval in Overlord, only with Allow once or Deny; the channel credential cannot answer
  anything. A request Codex asks again about the same item gets a new card, never the earlier
  answer.
- **Process cleanup.** The server runs in its own process group; normal exit interrupts the turn,
  stops the group and removes the socket, state file and credential; the watchdog and orphan
  reaping cover a killed supervisor.

### Trust caveat

While a session runs, Codex treats its working directory as **trusted**: `thread/start` writes
`trust_level = "trusted"` for it into `~/.codex/config.toml`. Trusted means the checkout's own
Codex project config, hooks and MCP servers load and can run code, the same as answering "Trust"
in the Codex TUI. Overlord removes that entry when the session ends (never one you wrote, an
explicit `untrusted`, or a table with other keys), but during the session it applies. Use
app-server mode only on repositories you would trust in Codex.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| The objective launched in a terminal with a warning | Codex is missing or older than 0.170.0, or the backend could not mint the channel. Upgrade Codex, or check `ovld doctor`. |
| No approval cards appear | The thread's approval policy allows the work without asking (the default `on-request` + `workspace-write`). Set `-a untrusted` or `-a on-request` with a stricter sandbox in the Codex launch flags (`--flag=…` for a direct launch). |
| An approval card is read-only | You did not launch this session; only the launching member can answer its approvals. Or the session has ended. |
| The agent's `ovld` calls fail with "Could not reach Overlord backend" | The sandbox blocks network. The agent can ask to rerun the command with escalated permissions (an approval card), or allow the backend's host in your Codex network permissions. |
| The TUI shows "Reconnecting to server…" | The session ended (objective complete, delivered and idle, or stopped) and the private server stopped. Nothing to fix. |
| The Codex status line or MCP tools show nothing | The Overlord plugin in `~/.codex` is older than this connector. Rerun `ovld agent-setup codex`. |
| `ovld agent-session attach` waits | The thread's rollout exists only after the first turn starts; attach retries until then. |

## Running the sidecar by hand

```
OVERLORD_CODEX_APP_SERVER=1 ovld agent-session sidecar --agent codex-app-server \
  [--socket <path>] [--thread-id <id>] [--prompt-file <path>] [--working-directory <dir>]
```

The sidecar needs a session channel in its environment (`OVERLORD_SESSION_CHANNEL_ID` plus the
owner-only credential) and `OVERLORD_BACKEND_URL`. Without a channel it does nothing at all.

## What it does

- **Starts a private server.** `codex app-server --listen unix://~/.ovld/cx/<id>.sock`, with an
  owner-only socket directory, an allowlisted environment (no Overlord token, channel credential
  or objective scope), and its own process group. Codex keeps the real `0600` socket in its own
  `0700` directory and leaves a symlink at that path. `--socket` connects to an existing private
  server instead.
- **Checks the version.** `codex --version` before spawning and the `initialize` user agent
  after connecting must be at least the verified version (0.170.0).
- **Binds one thread.** `thread/start` (or `thread/resume` with `--thread-id`) with
  `approvalsReviewer: "user"` always, so a user config with `auto_review` can never take
  approvals away from Overlord and the person. The thread id becomes the channel's native
  session alias. `--prompt-file` is sent as the first turn.
- **Observes.** Each notification is projected (`event`, `context.cwd`) and normalized through
  [`codec/codex-app-server.codec.yaml`](codec/codex-app-server.codec.yaml): prompts and steering
  messages, command and file-change items (pre-mutation diff first, then the result), turns and
  thread lifecycle. Diffs, command output and message text never leave the machine. Completed
  file changes are also recorded in the local change ledger (`ovld protocol capture-change`).
- **Answers approvals.** Command and patch approvals become permission cards. A person's allow
  is `accept`; a deny is `decline`, or `cancel` when Codex did not offer decline. Standing grants
  (`acceptForSession`, policy amendments) are never sent. Overlord policy may only ever answer a
  plain `command` approval; everything else goes to a person. Unknown server requests are
  refused, so Codex never waits on Overlord for something it cannot answer.
- **Lets the terminal answer too.** Codex sends an approval to every subscriber and takes the
  first answer. A person attached with `codex --remote unix://<socket> resume <thread>` can
  answer while Overlord holds the card; the card then closes as resolved elsewhere.
- **Injects.** A claimed inbox instruction is `turn/steer` (with the active turn as a
  precondition) while a turn runs, and `turn/start` otherwise. Both are reported Delivered.
- **Stops.** When the channel ends or the sidecar is signalled, the running turn is interrupted
  (`turn/interrupt`) and the server is stopped.
- **Reconnects.** A dropped connection is retried with backoff; the thread is resumed, Codex
  replays pending approvals, and cards whose approval was not replayed close as resolved
  elsewhere.
- **Attributes child threads.** Codex sends every thread's notifications and approvals to every
  connection. Subagents the agent spawns (announced by the parent's `subAgentActivity` item) and
  forks made from an attached TUI (`thread/started` with `forkedFromId`) belong to the session:
  their events go to the same channel, correlated with the root thread and with the child thread
  as `subagentId`; their completed edits reach the change ledger; their approval cards carry
  `details.subagent` (thread id, depth, agent path). An unknown thread is checked once with
  `thread/read` (parent, fork source, or the root's inherited `sessionId`); a thread outside the
  session is ignored, and its approvals are left to the client that started it. Stopping the
  session interrupts a subagent's running turn too.
- **Imports history after a resume.** Notifications are not replayed, so after every resume
  (a respawned server, a dropped connection, `--thread-id`) the supervisor pages
  `thread/turns/list` for each thread of the session (subagents found with
  `thread/list {parentThreadId}`) and replays completed prompts, commands, file changes and
  subagent lifecycle through the live path. Event ids equal the live ones and the change ledger
  appends a path once, so nothing already recorded is duplicated; a fork's inherited source
  turns are skipped. Model text is never imported.

## Evidence and re-recording

Every `supported` row in [`CAPABILITIES.md`](CAPABILITIES.md) is proven by a fixture built from
frames recorded on a live 0.170.0 server. The whole path was re-run end to end on 0.171.0
(coo:1325.tg2w): launch, events, command and patch approvals answered from the web app with the
TUI attached, a mid-turn steer, an interrupt and resume from the TUI, a subagent's work
attributed to the session, delivery with change evidence, and cleanup. `replay-*.json` fixtures run the shipped supervisor
against those frames (`scripts/codex-app-server-replay.mjs`) and assert the exact JSON-RPC bytes
it sends back. To re-record after a Codex upgrade:

```
TSX_TSCONFIG_PATH=scripts/codex-app-server.tsconfig.json \
  node --import tsx scripts/codex-app-server-record.mts <out-dir> [a|b|c]
```

Scenario `c` records a spawned subagent, a fork and a resumed supervisor's history import.

The output contains local paths; redact it before turning it into fixtures.

## Known limits

- Overlord cannot send instructions, steering or interrupts to the session yet (the session-input
  route is closed for every agent); type them in the attached TUI. The mobile app shows approval
  cards read-only.
- Commands run under Codex's sandbox. A `workspace-write` sandbox without network access can block
  the agent's own `ovld` calls, which then arrive as approval requests.
- `answer.structuredQuestion` and `decide.mcp` are unverified: no live server raised
  `item/tool/requestUserInput` or an MCP elicitation in the probes.
- A fork made while Overlord was disconnected is not found by the history import (Codex has no
  fork filter on `thread/list`); spawned subagents are.
- macOS and Linux only (Unix sockets).
