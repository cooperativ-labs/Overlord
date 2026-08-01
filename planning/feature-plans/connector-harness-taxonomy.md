# Connector Harness Taxonomy

Status: proposed. The harness-specific half of
[connector-hook-standard.md](./connector-hook-standard.md) (the harness-agnostic
core), which in turn serves
[agent-interaction-acp.md](./agent-interaction-acp.md) (the backend Agent Session
Exchange).

For each of five harnesses this document answers the three questions the
objective asked: **can it be done**, **what is uniquely hard about this one**,
and **how does the adapter work**.

---

## 0. Evidence

Everything below marked **verified** was read from software installed in this
container, not from documentation. Where documentation is cited it is named as
such, and where a claim could not be established it is marked **unverified** and
appears in §7 as a required spike rather than as an assumption.

| Harness      | Version            | How it was read                                                                                                          |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Claude Code  | 2.1.220            | `@anthropic-ai/claude-code/bin/claude.exe`                                                                               |
| Codex        | codex-cli 0.146.0  | Rust binary in `@openai/codex-linux-arm64`; `codex features list`; generated app-server JSON Schema; official hooks docs |
| Cursor Agent | 2026.07.23-e383d2b | JS bundles in `/opt/cursor-agent/versions/...`                                                                           |
| Pi           | 0.83.0             | `@earendil-works/pi-coding-agent` TypeScript declarations from npm                                                       |
| OpenCode     | 1.18.10            | Bun binary, **plus a live server**: its OpenAPI document and endpoints were fetched from a running instance              |

The OpenCode result is the strongest evidence in this document and the most
consequential, so it is worth being explicit about how it was obtained: an
interactive OpenCode TUI was launched with `--port 4097`, and `GET /app`,
`GET /session`, `GET /permission`, `GET /question`, and the `GET /event` SSE
stream all responded from that live TUI process. The event stream immediately
emitted `server.connected`. That is not an inference from a binary; it is the
feature working.

One caveat on Codex: this container has no Codex credentials, so nothing about
Codex could be confirmed by running a session. Its row is the least certain of
the five and is graded accordingly.

Scope note: the repository also ships an `antigravity` adapter. The objective
named Claude, Codex, Cursor, Pi, and OpenCode, so Antigravity is out of scope
here and keeps its existing open item in the core document.

---

## 1. Summary

|                                              | Claude Code                   | Codex                                         | Cursor Agent                      | Pi                              | OpenCode                        |
| -------------------------------------------- | ----------------------------- | --------------------------------------------- | --------------------------------- | ------------------------------- | ------------------------------- |
| **Possible?**                                | Yes                           | Yes                                           | Yes, partially                    | Yes                             | Yes, best of the five           |
| **Integration shape**                        | A — callback                  | A — callback                                  | A — callback                      | B — in-process                  | C — control plane               |
| **Native session id to a subprocess**        | Yes, `CLAUDE_CODE_SESSION_ID` | `CODEX_THREAD_ID` exists, equality unverified | In payload, not confirmed in env  | In-process, `getSessionId()`    | Not needed; sessions enumerable |
| **Can hold a decision**                      | Yes                           | Yes                                           | Yes                               | Yes, without blocking a process | N/A — no hold needed            |
| **Native prompt answerable during the hold** | No                            | No                                            | No                                | No prompt exists                | **Yes**                         |
| **Decision timeout ceiling**                 | Per-hook seconds              | Per-hook seconds, docs say 600s default       | Per-hook seconds, **60s default** | None                            | N/A                             |
| **Mid-turn injection**                       | `asyncRewake`                 | app-server only, experimental                 | Turn boundary only                | Yes, `deliverAs: "steer"`       | Yes, `prompt_async`             |
| **Realistic tier**                           | 3                             | 2                                             | 2                                 | 3                               | 3                               |
| **Adapter exists today**                     | Yes, mostly broken            | Yes, broken                                   | Yes, mis-declared                 | Yes, observational              | **None**                        |

### 1.1 The axis that actually matters

The instinct is to sort these by "does it have hooks". That is the wrong axis.
The distinction that changes the product is:

> **Can the harness's own UI answer the same request while Overlord is also
> offering to answer it?**

For Claude, Codex, and Cursor the answer is no, and it is no for a structural
reason: the native prompt is drawn only after the callback returns, so holding
the callback open is simultaneously the only way to answer remotely and the
reason nobody can answer locally. Every bit of complexity in the decision window
— presence sizing, idle-to-active release, revision CAS against a terminal
outcome we cannot observe — descends from that one fact.

For OpenCode the answer is yes. The TUI and Overlord are peers on one event bus,
both subscribed, both able to `POST /permission/{id}/reply`. First-answer-wins
is not a policy there, it is just what happens. No window, no release, no
presence heuristic.

For Pi the question does not arise, because Pi has no native permission prompt
at all — which sounds like the easy case and is in fact the one that needs the
most careful thought (§5).

---

## 2. Claude Code 2.1.220

### 2.1 Possible?

Yes, at Tier 3, and it is the only harness where every mechanism the feature
needs is already present, documented, and stable.

### 2.2 What is verified

Thirty-one hook events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
`PostToolBatch`, `Notification`, `UserPromptSubmit`, `UserPromptExpansion`,
`SessionStart`, `SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`,
`SubagentStop`, `PreCompact`, `PostCompact`, `PermissionRequest`,
`PermissionDenied`, `Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`,
`Elicitation`, `ElicitationResult`, `ConfigChange`, `WorktreeCreate`,
`WorktreeRemove`, `InstructionsLoaded`, `CwdChanged`, `FileChanged`,
`DirectoryAdded`, `MessageDisplay`.

Per-command config: `command`, `args` (exec form, no shell), `if`, `shell`,
`timeout` (seconds), `statusMessage`, `asyncRewake`.

`PermissionRequest` returns:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow", "updatedInput": {}, "updatedPermissions": [] }
  }
}
```

or `{"behavior":"deny","message":"…","interrupt":true}`. Omitting `decision`
falls through to the native prompt — the failure mode the core requires.

`PreToolUse` returns `permissionDecision: "allow" | "deny" | "ask" | "defer"`,
resolved across hooks with precedence `deny > defer > ask > allow`.
`Stop` accepts `decision: "block"` with a `reason`, capped by
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`. `asyncRewake` runs a hook in the background
and, on exit code 2, wakes the model with the hook's stdout injected as a
system-reminder — a live mid-turn injection channel into an ordinary interactive
terminal session. `CLAUDE_CODE_SESSION_ID` is exported into tool subprocesses,
so `ovld protocol attach` binds synchronously from its own environment. The TUI
renders a `running <hook> hook…` spinner for the duration of a hook, which is
why no native dialog is answerable while one is held.

### 2.3 Unique challenges

- **Everything is already built and none of it works.** All three non-edit hooks
  are dead: `permission-hook.sh` calls a `ovld protocol permission-request`
  subcommand that does not exist, `stop-hook.sh` calls a hook type the CLI
  rejects and then parses a `deliveryStatus` field nothing produces, and both are
  gated on a `MISSION_ID` environment variable that agent-pod sessions never set.
  Every one fails silently by design. This is not a defect to fix alongside the
  feature; it is Phase 0 of the feature.
- **`permission-hook.sh` ends in `) & disown`.** A backgrounded hook with stdout
  to `/dev/null` is structurally incapable of returning a decision no matter what
  the CLI does.
- **`statusMessage` is static configuration.** It is set at install time with no
  per-request interpolation, and the `if` field is permission-rule syntax
  (`Bash(git *)`) rather than an arbitrary predicate, so it cannot be gated on
  session binding either. It renders in every session including unbound ones.
  That is tolerable only because visibility is proportional to blocking time —
  an unbound hook exits in milliseconds and the message flashes imperceptibly —
  so it must be worded as an option, not an instruction.
- **Fork and subagent identity are unknown.** Whether an in-process fork mints a
  new session id, and whether subagent tool calls carry the parent's id, are both
  unverified and both route requests to the wrong mission if guessed wrong.

### 2.4 Adapter design

Shape A, thin pipes. `PermissionRequest` with an explicit `timeout` above the
long window and a `statusMessage` naming `ovld requests`; the script pipes stdin
to a CLI subcommand that gates on binding, creates the request, waits, and prints
the native decision shape on stdout. `PostToolUse` and `UserPromptSubmit` stay
observational. `SessionStart` is registered for the fork question. Injection uses
an `asyncRewake` hook as the primary channel with `Stop` `decision: "block"` as
the portable backstop.

**Tier 3.** Reference implementation for Shape A.

---

## 3. Codex 0.146.0

### 3.1 Possible?

Yes for answering, at Tier 2. Tier 3 is plausible but rests on an experimental
surface. Codex is the harness this document is least confident about, purely
because it could not be exercised here.

### 3.2 What is verified

`codex features list` reports `hooks` as **stable, enabled**. Hook events present
in the binary: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`,
`PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`,
`UserPromptSubmit`, `Stop`, `Notification`, and `TurnStart`/`TurnEnd`.

Payload fields: `session_id`, `turn_id`, `agent_type`, `transcript_path`, `cwd`,
`hook_event_name`, `model`, `permission_mode`, `trigger`, `tool_name`,
`tool_input`, `tool_use_id`.

The decision wire types are named `PermissionRequestBehaviorWire` (`allow`,
`deny`), `PermissionRequestDecisionWire`, `PreToolUseDecisionWire` (`approve`,
`block`), and `BlockDecisionWire`, alongside `hookEventName`,
`permissionDecision`, `permissionDecisionReason`, `additionalContext`, and
`updatedMCPToolOutput`. Exit code 2 denies, with the reason read from stderr —
the binary carries the error string "PermissionRequest hook exited with code 2
but did not write a denial reason to stderr". Timeouts are per-hook and in
seconds ("hook timed out after {}s"); `timeoutSec` appears in the binary and the
official documentation gives `timeout` with a 600-second default.

Configuration loads from `~/.codex/hooks.json`, repo `.codex/hooks.json`, inline
`[hooks]` tables in either `config.toml`, and plugin-bundled `hooks/hooks.json`
— which is how Overlord installs today.

Separately, Codex has a **second, entirely different integration surface**:
`codex app-server` (JSON-RPC over a control socket, with `daemon`, `proxy`, and
`remote-control` subcommands). Its generated schema includes
`ThreadInjectItems`, `TurnSteer`, `TurnInterrupt`, `ThreadResume`,
`ThreadLoadedList`, `PermissionsRequestApproval`, and — notably —
`ToolRequestUserInput`, a native structured question with `questions`, per-option
`label`/`description`, and an `autoResolutionMs`. That is an ACP-shaped surface
in everything but name.

### 3.3 Unique challenges

- **Two integration surfaces that could disagree.** Hooks and the app-server can
  both answer a permission. Choosing one and documenting why is necessary before
  either is built, because a session driven by both would race in a way no
  revision CAS can settle.
- **The app-server may be single-subscriber.** The binary carries the strings
  "timed out waiting for a client to subscribe to the thread after {}s" and
  "expected exactly one client subscribed to the thread, found {}". If the TUI is
  that one client, Overlord cannot also subscribe, and the Shape C path for Codex
  is closed. This single question decides whether Codex ends up looking like
  Claude or like OpenCode.
- **`CODEX_THREAD_ID` is not known to equal the hook `session_id`.** The binary
  distinguishes `session_id`, `turn_id`, and thread ids, and `CODEX_THREAD_ID`
  appears adjacent to an environment-name list whose purpose could not be
  determined. Assuming symmetry with Claude here is exactly the kind of guess
  that produces silent misattribution.
- **A previous claim in this planning set is not supported.** An earlier draft
  recorded as verified that Codex "fails closed if `updatedInput`,
  `updatedPermissions`, or `interrupt` is present". Those field names do appear
  in the `PermissionRequest` decision wire types in this build, and no
  corresponding fail-closed string could be found. The claim is downgraded to
  unverified and must be re-established by fixture before any adapter relies on
  either behavior.
- **Version and platform gating.** Hooks were experimental behind
  `features.codex_hooks` before v0.124 and are documented as unavailable on
  Windows. The adapter must detect the harness version and degrade to Tier 1
  rather than register a hook that will never fire.
- **The shipped adapter is broken in the same way Claude's is** — same
  nonexistent subcommand, same `& disown`, same `MISSION_ID` gate.

### 3.4 Adapter design

Shape A, mirroring Claude with a distinct dialect in `resolve`: `allow`/`deny`
only, exit code 2 plus stderr as the denial path, and no
`updatedInput`/`updatedPermissions`/`interrupt` until a fixture proves them safe.
Explicit `timeout` set from the window policy and well below the 600-second
default. Binding via the payload `session_id` (fallback order item 2) until
`CODEX_THREAD_ID` equality is settled, at which point it moves to item 1.

The app-server is deliberately deferred rather than rejected: if the
single-subscriber question resolves favorably, Codex graduates to Shape C with
`ThreadInjectItems`/`TurnSteer` for injection and `ToolRequestUserInput` as a
native structured-question source — a materially better connector than the hook
path can ever be. That is a follow-on, not a prerequisite.

**Tier 2** on hooks. Tier 3 only via the app-server.

---

## 4. Cursor Agent 2026.07.23

### 4.1 Possible?

Yes, but partially, and with the most caveats of the three callback harnesses.
Cursor can answer permission requests for _shell and MCP calls_ — which is most
of what matters — but it has no general permission event, and its shipped
Overlord manifest currently claims one that does not exist.

### 4.2 What is verified

Twenty-one hook steps: `beforeShellExecution`, `beforeMCPExecution`,
`afterShellExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`,
`beforeTabFileRead`, `afterTabFileEdit`, `stop`, `beforeSubmitPrompt`,
`afterAgentResponse`, `afterAgentThought`, `sessionStart`, `sessionEnd`,
`preCompact`, `subagentStart`, `subagentStop`, `preToolUse`, `postToolUse`,
`postToolUseFailure`, `workspaceOpen`.

Cursor ships an explicit Claude-compatibility map, and it is worth quoting its
shape because it settles the question directly:

```js
{ PreToolUse: preToolUse, PermissionRequest: null, PostToolUse: postToolUse,
  UserPromptSubmit: beforeSubmitPrompt, Stop: stop, SubagentStop: subagentStop,
  SessionStart: sessionStart, SessionEnd: sessionEnd, PreCompact: preCompact,
  Notification: null }
```

`PermissionRequest` and `Notification` map to `null` and appear in an explicit
unsupported list. **Cursor does not have a PermissionRequest hook and is not
going to grow one by accident.**

What it has instead is better in some ways. `beforeShellExecution` and
`beforeMCPExecution` return `permission: "allow" | "deny" | "ask"` plus
`user_message` and `agent_message`. `preToolUse` returns the same three plus
`updated_input` and `additional_context`. `beforeReadFile` and
`beforeTabFileRead` return `allow`/`deny`. `stop` returns `followup_message` —
a first-class continuation channel. `sessionStart` can return `env`,
`additional_context`, `continue`, and `user_message`.

Hook input carries `conversation_id`, an optional `session_id`,
`hook_event_name`, `cursor_version`, `workspace_roots`, `user_email`, and
`transcript_path`. Hooks are resolved from six sources — enterprise, team,
project, user, **and Claude's own project-local, project, and user hook
configurations** — with a per-script `failClosed` flag and a per-script
`timeout` in seconds defaulting to **60**. There is also a translation layer,
gated behind `enableClaudeNestedHookSpecificOutputCompatibility`, that converts
Claude's `decision: "block"` + `reason` into `followup_message`.

### 4.3 Unique challenges

- **The manifest claims a capability the harness does not have.** Cursor's
  conformance manifest declares `permissionHook` and a `PermissionRequest` hook
  type. Cursor maps that event to `null`. This must be corrected regardless of
  whether the rest of the feature ships.
- **Permission coverage is per tool class, not universal.** There is no single
  event that fires for every approval. Shell, MCP, file read, and the generic
  `preToolUse` each cover a slice. The adapter must register several and the UI
  must not imply that every Cursor approval will appear in Overlord.
- **The 60-second default is an order of magnitude too short.** A remote window
  sized for a human who is away from the keyboard cannot live inside a
  60-second ceiling, so the adapter must set `timeout` explicitly and treat the
  default as a bug waiting to happen.
- **Cursor reads Claude's hook configuration.** This is the sharpest
  cross-connector hazard in the survey: on a machine with both connectors
  installed, Overlord's Claude hooks may fire inside Cursor sessions, where they
  would emit Claude-shaped decisions into a Cursor-shaped contract. Whether
  Cursor's `claudeUserHooks` source expands _plugin_-provided hooks or only
  `settings.json` entries is unverified, and it is the highest-ranked spike in
  §7 because it can produce misattributed events with no code change on our
  side.
- **A reported upstream defect.** Community reports state that
  `beforeShellExecution`'s `allow`/`ask` responses are ignored when a
  command-allowlist entry matches, with the allowlist taking precedence
  ([forum report](https://forum.cursor.com/t/beforeshellexecution-hook-permissions-allow-ask-ignored-allow-list-takes-precedence/144244)).
  If true, a remote approval may be a no-op for allowlisted commands. Harmless
  in itself — the command was going to run — but it means the adapter cannot
  treat "we returned allow" as proof the decision took effect.
- **`failClosed` inverts the core's failure rule.** Cursor's `failClosed: true`
  converts a hook failure into a _block_. The core requires failing toward the
  harness, so Overlord's scripts must leave `failClosed` off and say why in a
  comment, because it is exactly the kind of flag someone helpfully turns on.

### 4.4 Adapter design

Shape A. Register `beforeShellExecution`, `beforeMCPExecution`, and `preToolUse`
as the decision surfaces with an explicit `timeout`; `beforeSubmitPrompt`,
`postToolUse`, and `afterFileEdit` as observational; `stop` for injection via
`followup_message`. `resolve` emits Cursor's own dialect —
`{permission, user_message, agent_message}` — never Claude's nested
`hookSpecificOutput`, even though Cursor would accept it under a compatibility
flag, because relying on another vendor's compatibility shim for our primary
path is a dependency we do not need. Binding from `session_id ?? conversation_id`
in the payload.

**Tier 2**, with `followup_message` making a limited Tier 3 available at turn
boundaries.

---

## 5. Pi 0.83.0

### 5.1 Possible?

Yes, at Tier 3, and with the least ceremony of any harness — but for reasons
that make it the least like the others.

### 5.2 What is verified

Pi extensions are TypeScript modules loaded in-process, and Overlord already
ships one at `connectors/adapters/pi/extensions/overlord.ts`. The typed
`ExtensionAPI` exposes roughly thirty events, of which these matter here:

- `tool_call`, whose handler is `async` and returns `{ block?: boolean, reason?: string }`,
  and whose `event.input` is mutable in place — a decision point that can await
  a remote answer without blocking any process.
- `tool_result`, `tool_execution_start/update/end`, `message_start/update/end`,
  `turn_start/turn_end`, `agent_start/agent_end/agent_settled` — a complete
  observational surface.
- `input`, carrying `source: "interactive" | "rpc" | "extension"` and
  `streamingBehavior: "steer" | "followUp"`, returning
  `{action: "continue" | "transform" | "handled"}`.

For injection, `pi.sendUserMessage(content, { deliverAs: "steer" | "followUp" })`
sends a real user message and always triggers a turn, and `pi.sendMessage(...)`
sends a custom message with `triggerTurn` and
`deliverAs: "steer" | "followUp" | "nextTurn"`. `steer` is genuine mid-turn
injection, not a queued message that lands at the next boundary.

`ctx.sessionManager.getSessionId()` provides binding in-process, which the
existing extension already uses to write a native-session cache under
`~/.ovld/native-sessions`. `ctx.ui` offers `select`, `confirm`, `input`, and
`notify`, with `hasUI` true in both `tui` and `rpc` modes. `ExtensionMode` is
`"tui" | "rpc" | "json" | "print"`.

### 5.3 Unique challenges

- **There is no native permission prompt, so there is no floor.** This is the
  important one. For every other harness, "fail toward the harness" means "let
  the native dialog appear", and the worst case is that a human answers in the
  terminal. Pi has no dialog. A `tool_call` handler either returns (the tool
  runs) or blocks with a reason (the model is told it was refused). There is no
  third option and no one to defer to. So for Pi, failing toward the harness
  means **allowing**, and a timed-out remote request must let the tool proceed —
  which is a materially different risk posture and must be stated in the UI
  rather than implied by a shared label. The existing
  [pi-agent-connector.md](./pi-agent-connector.md) already refuses to claim
  `permissionHook` for this reason, and that judgment holds.
- **Blocking is visible to the model, not just to the user.** A block becomes a
  tool refusal in the conversation and changes what the agent does next. Using
  `block` as a "please wait" mechanism would corrupt the session, so the wait has
  to happen _before_ returning, inside the async handler.
- **In-process means maximum blast radius.** The extension runs with the agent's
  memory, credentials, and event loop. An unhandled exception is a crash in
  someone's editor, and anything the extension reads is trivially readable. The
  §11.2 thin-binding rule is not stylistic here; it is the whole safety story.
- **Version coupling.** The extension is typed against
  `@earendil-works/pi-coding-agent` 0.83.0. A typed in-process API is far more
  breakable than a JSON contract on stdin, so the adapter needs a version check
  and a graceful "extension disabled, mission workflow unaffected" path.
- **`rpc` mode is an unexplored second surface.** `InputSource` includes `"rpc"`
  and `ExtensionMode` includes `"rpc"`, implying Pi can be driven programmatically
  the way OpenCode can. Not needed for Tier 3, but worth knowing it exists before
  concluding that in-process is the only option.

### 5.4 Adapter design

Shape B. Extend the existing extension: keep `input` capture, add `tool_call` as
the decision point (await the CLI, then return `{}` to allow or
`{block: true, reason}` to deny), add `turn_start`/`turn_end`/`agent_settled` as
observational events, and implement `inject` as `sendUserMessage` with
`deliverAs: "steer"` when streaming and `"followUp"` when idle — the one adapter
that can honestly return `Delivered` for a mid-turn message. All network work
goes through `pi.exec('ovld', ...)`; the extension itself holds no token and
makes no HTTP call.

**Tier 3**, with an explicit note in the UI that Pi has no terminal fallback.

---

## 6. OpenCode 1.18.10

### 6.1 Possible?

Yes — and it is the only harness where the feature is _native_ rather than
reconstructed. OpenCode already models remote permission answering, remote
question answering, and remote prompt injection as first-class API operations.
There is no Overlord connector for it today, which makes it the largest
capability gap in the current connector set.

### 6.2 What is verified

OpenCode is a client/server system. The TUI _is_ an HTTP server. Launching
`opencode --port 4097` and querying that port from another process returned the
full API, including a live SSE stream.

Endpoints relevant here, taken from the running server's own OpenAPI document:

| Operation             | Endpoint                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Event stream (SSE)    | `GET /event`                                                                                 |
| List open permissions | `GET /permission`                                                                            |
| Reply to a permission | `POST /permission/{requestID}/reply` — `{ reply: "once" \| "always" \| "reject", message? }` |
| List open questions   | `GET /question`                                                                              |
| Reply to a question   | `POST /question/{requestID}/reply` — `{ answers }`                                           |
| Reject a question     | `POST /question/{requestID}/reject`                                                          |
| Send a prompt         | `POST /session/{sessionID}/message`, `POST /session/{sessionID}/prompt_async`                |
| Abort a turn          | `POST /session/{sessionID}/abort`                                                            |
| Drive the TUI         | `POST /tui/append-prompt`, `/tui/submit-prompt`, `/tui/show-toast`, `/tui/execute-command`   |

Event types on the bus include `permission.asked`, `permission.replied`,
`question.asked`, `question.replied`, `question.rejected`, `session.status`,
`session.idle`, `session.error`, `message.part.updated`, `tool.execute.before`,
`tool.execute.after`, and `file.edited` — each carrying `sessionID`.

There is additionally a TypeScript plugin API (`~/.config/opencode/plugin`,
`.opencode/plugins`) with `permission.ask`, `tool.execute.before/after`,
`chat.message`, `chat.params`, and an `event` subscription — a Shape B surface
sitting inside the same product. And `opencode acp` runs OpenCode as an ACP
server, while `opencode attach <url>` is a supported client of a running server.
Basic auth is available via `OPENCODE_SERVER_USERNAME` /
`OPENCODE_SERVER_PASSWORD`; the server prints a warning when unset.

### 6.3 Unique challenges

- **Reachability is decided at launch.** The API is only reachable if the process
  was started with a known `--port` (or discovered by mDNS, which is not
  appropriate here). A session the user started themselves is invisible. Overlord
  already controls the launch command, so this is solvable for launched
  sessions — but it draws a hard line between launched and adopted sessions that
  the other harnesses do not have, and the UI must not promise coverage for
  sessions Overlord did not start.
- **Unsecured by default.** The server warns and continues when no password is
  set. The adapter must bind loopback only and set `OPENCODE_SERVER_PASSWORD` to
  a per-launch secret. An HTTP server on a developer machine that can approve
  file writes and inject prompts is a genuinely attractive target, and "it only
  listens on 127.0.0.1" is necessary but not sufficient.
- **`"always"` is a durable policy change, not an answer.** Replying `always`
  writes a persistent permission rule. Approving one command from a phone and
  silently granting a standing rule are very different acts, and the UI must
  distinguish them — this is the one place where a remote surface can do
  something _more_ consequential than the terminal, rather than less.
- **The sidecar can miss events.** Being a subscriber rather than a callback
  means a disconnect loses whatever arrived during the gap. This is entirely
  recoverable — `GET /permission` and `GET /question` enumerate what is
  outstanding, so reconnect re-reads state instead of assuming continuity — but
  it must be built that way from the start rather than added after the first
  missed approval.
- **Port allocation and lifecycle.** Ports must be allocated per launch, recorded
  with the execution request, and released on exit; a stale record pointing at a
  reused port is a way to send a reply into an unrelated session.
- **Three surfaces, one product.** REST, plugin API, and ACP all overlap. Picking
  REST and documenting why keeps the adapter from drifting into using all three.

### 6.4 Adapter design

Shape C — the first of its kind in the connector set, and the reason the core
was rewritten to admit shapes at all.

Launch: `opencode --port <allocated> --hostname 127.0.0.1` with
`OPENCODE_SERVER_PASSWORD` set to a per-launch secret, recorded against the
execution request. A supervised sidecar subscribes to `GET /event`, filters to
sessions belonging to that instance, and translates `permission.asked` and
`question.asked` into answerable requests and the rest into normalized events.
Resolution is a `POST` to the reply endpoint; if the terminal answered first the
reply returns an error and the request is marked resolved-elsewhere, which is
**an honest outcome the other harnesses cannot produce**. Injection is
`POST /session/{id}/prompt_async`, returning `Delivered`. On reconnect the
sidecar re-reads `/permission` and `/question` before trusting the stream again.

The plugin API is deliberately not used: it would put Overlord code inside the
agent process to obtain capabilities the REST API already provides from outside
it.

**Tier 3**, and the highest-fidelity connector of the five — the only one where
web, mobile, and terminal are genuinely equal peers.

---

## 7. Open verification items

Ranked by how much depends on them.

1. **Does Cursor's Claude-hook ingestion expand plugin-provided hooks, or only
   `settings.json` entries?** Decides whether installing both connectors on one
   machine causes Claude hooks to fire in Cursor sessions. Cross-connector
   misattribution with no code change on our side.
2. **Is the Codex app-server single-subscriber per thread?** Decides whether
   Codex is a Claude-shaped or an OpenCode-shaped connector.
3. **Does `CODEX_THREAD_ID` equal the Codex hook `session_id`?** Decides binding
   fallback tier for Codex.
4. **Do Codex `PermissionRequest` decisions accept or reject `updatedInput`,
   `updatedPermissions`, and `interrupt`?** A prior "verified" claim was not
   reproducible; re-establish by fixture.
5. **Harness behavior when the user interrupts during a held decision**, for all
   three callback harnesses. The request must become `cancelled`, never an
   implicit approval.
6. **Does an in-process Claude `fork` mint a new session id, and do subagent tool
   calls carry the parent's?** Same question for Codex subagents and Cursor
   `subagentStart`.
7. **Does OpenCode's `--port` survive session resume, and does a reused port ever
   serve a different instance?** Determines how aggressively the port record must
   be validated before a reply is sent.
8. **Cursor's allowlist-precedence defect** — reproduce, and if confirmed,
   surface "approved, but the command was already allowlisted" rather than
   claiming the approval was decisive.
9. **`statusMessage` truncation at narrow terminal widths** (Claude), and whether
   Cursor or Codex has an equivalent in-TUI status surface.
10. **Pi extension API stability across minor versions** — how much churn between
    0.8x releases, to size the version-guard work.

---

## 8. What this changes in the existing connectors

| Connector  | Change required                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`   | Repair four broken scripts; add explicit `timeout` and `statusMessage`; register `SessionStart`; add `asyncRewake` injection hook                                                                                 |
| `codex`    | Repair `permission-hook.sh`; add version/feature gate; emit the Codex dialect rather than Claude's; keep manifest at Tier 2                                                                                       |
| `cursor`   | **Remove the false `permissionHook` capability and `PermissionRequest` hook type**; register `beforeShellExecution` / `beforeMCPExecution` / `preToolUse` instead; set explicit `timeout`; leave `failClosed` off |
| `pi`       | Add `tool_call` decision handling and `sendUserMessage` injection; keep refusing `permissionHook` under the current vocabulary, and adopt the new capability names when the contract lands                        |
| `opencode` | **New connector.** No adapter exists; Shape C sidecar, launch-time port and secret, REST reply and injection                                                                                                      |

---

## 9. Recommended build order

Not strictly by tier, and not by how much of each adapter already exists.

1. **Claude** — Phase 0 repair first. Nothing else can be trusted while four
   shipped hooks fail silently, and Claude is the only harness where every needed
   mechanism is already verified.
2. **OpenCode** — second, deliberately, despite being a greenfield connector.
   It is the cheapest Tier 3 to build and the only one that exercises Shape C, so
   building it early is what proves the core is genuinely harness-agnostic. If
   the core cannot absorb a connector with no hooks, no held decision, and no
   release-to-terminal handoff, that is far better learned at connector two than
   at connector five.
3. **Pi** — third. Exercises Shape B, mid-turn injection, and the no-native-floor
   case, which together cover the remaining structural variation.
4. **Cursor** — fourth. Mostly mechanical once Claude's Shape A path exists, but
   gated on verification item 1.
5. **Codex** — last, because it is the least verifiable from here and because the
   app-server question may make the hook work redundant. Repairing its broken
   script is still Phase 0 work; building the decision path on top of it is not.

The sequencing argument is the same one that motivated splitting these documents:
a core written against one harness will silently encode that harness's
assumptions, and the only reliable way to find out is to make the second
connector as different as possible.
