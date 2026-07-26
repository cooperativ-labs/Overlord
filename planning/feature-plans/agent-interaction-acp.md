# Revamping Agent Interaction (coo:447)

Status: research + proposal. No implementation in this objective.
Research date: 2026-07-26. Contract version at time of writing: `29`.

## The ask

Let a user answer an agent's blocking questions, permission requests, and other
requests from the Overlord webapp or mobile app instead of walking to the
terminal, and let them push follow-up instructions into a running session —
**without replacing the terminal interface**. Agent Client Protocol (ACP) was
proposed as the vehicle. The activity feed overlaps with this, so either redesign
it or add a chat-like surface to the mission panel.

## Recommendation in one paragraph

**Do not adopt ACP as the interaction transport, and do not build a separate chat
pane.** ACP is disqualified by a structural constraint, not a maturity one: its
only stable transport requires the *client* to spawn the agent and own its stdio,
and Overlord launches agents by typing a command into a terminal window it does
not own. Instead, add one generic **agent-request/response primitive** to the
protocol — borrowing ACP's `PermissionOption` vocabulary so the data model is
standards-shaped and interoperable later — and deliver it over three mechanisms
that all already exist: a **blocking `ask`** (needs no harness support at all), a
**blocking `PermissionRequest` hook**, and **`asyncRewake` / `Stop` injection**
for unsolicited follow-up messages. Then evolve the activity feed from its current
hard-coded boolean branches into a **widget registry**, where a question widget
owns a reply field and a permission widget owns approve/deny buttons, plus one
composer pinned under the feed. The terminal stays authoritative throughout:
every request appears in both places and whoever answers first wins.

---

# Part 1 — What exists today

Everything in this section was verified first-hand against the working tree, not
inferred from docs.

## 1.1 Overlord never owns the agent's stdio

`cli/src/terminal-launcher.ts` builds a shell line and hands it to a terminal
emulator. For iTerm (`buildItermAppleScript`, `cli/src/terminal-launcher.ts:190`)
it emits AppleScript that creates a window, tab, or split and calls
`write text` with the agent invocation. `terminalInnerCommand`
(`cli/src/terminal-launcher.ts:116`) `cd`s into the project, re-exports the
`TMPDIR` family and launch env vars, runs the project's pre-launch commands, then
starts the agent.

Three consequences:

- Overlord holds **no file descriptors** on the agent process. It is a
  grandchild of a terminal app, not a child of Overlord.
- The session handle is **not retained**. The AppleScript writes into
  `current session of newWindow` and discards the reference, so Overlord cannot
  later address that specific pane.
- This is macOS + iTerm/Terminal specific, with a generic fallback
  (`buildGenericPlacementShell`, `cli/src/terminal-launcher.ts:311`).

This single fact drives the entire design. Any mechanism that requires owning the
agent's stdin is off the table for the launch mode Overlord actually ships.

## 1.2 The activity feed is read-only and its widget dispatch is hard-coded

`webapp/web/components/LiveActivityFeed.tsx` is the whole feed. `EVENT_META`
(line 37) maps each of the eleven `mission_events.type` values to an icon and a
label. `ActivityEntry` (line 341) then branches on three inline booleans:

```ts
const isUserFollowUp = event.type === 'user_follow_up';
const isBlockingQuestion = event.type === 'ask';
const isDelivery = event.type === 'delivery' && Boolean(event.deliveryId);
```

Those three booleans are threaded through ternary-chained Tailwind class strings
for the icon colour, the label colour, and the article wrapper. Only `delivery`
has a genuinely distinct body (`DeliveryExpandable` → `DeliveryDetails` →
`DeliveryPresentation`, lines 174–339). `ask` gets an amber outline and nothing
else. `permission_request` has an icon (line 44) and no code path that ever
produces one.

There is **no interactive affordance anywhere in the feed**, and no composer.
`GET /api/missions/:id/events` (`backend/index.ts:1458-1461`) has no `POST`
counterpart — the webapp physically cannot write a mission event.

The mission panel (`webapp/web/components/MissionPanel.tsx:342-381`) is a single
scroll column: objectives card, then a muted section with Tools & Criteria,
Activity, Artifacts, File Changes. Realtime arrives by SSE on
`GET /api/stream` (`backend/index.ts:1117`, `backend/realtime.ts:102`), which
invalidates the React Query cache (`webapp/web/lib/queries.ts:466`).

## 1.3 `ask` is a dead end by design

`askQuestion` (`packages/core/service/protocol.ts:1331`) inserts one
`mission_events` row with `type='ask'` and `phase='blocked'`, enqueues an
`agent_question` push notification, and calls `moveMissionToReview`. It returns
`{ eventId }`.

`contract/protocol-commands.yaml:156` states the rule plainly: *"Agent MUST stop
after calling ask."* There is no answer column, no answer endpoint, and no
channel by which an answer could reach the agent.

So the notification half of the loop is already built — coo:444 ships an
`agent_question` push category that fires from exactly this transaction — and it
delivers the user to a read-only feed. **The user is already being paged for
questions they cannot answer.** That is the sharpest framing of the gap.

## 1.4 The permission round-trip is already specified but never built

`database/docs/09-database-schema-contract.md:1767` documents a
`permission_requests` table in full, including a human-resolution model:

| Column | Notes |
| --- | --- |
| `tool_name`, `request_summary`, `payload_json` | secret-redacted |
| `status` | `requested` \| `approved` \| `denied` \| `expired` \| `not_required` |
| `resolved_by_workspace_user_id` | FK to `workspace_users` |
| `resolved_at` | |

`CONTRACT.md:623-624` lists both `permission_requests.status` and the
`permission_request` / `awaiting_approval` values of `mission_events.type` as
closed vocabularies. A sibling `hook_events` table is documented at
`database/docs/09-database-schema-contract.md:1742`.

**Neither table is created by any migration.** `grep` across
`database/postgres/migrations` and `database/sqlite/migrations` finds
`permission_request` only inside the `mission_events.type` CHECK constraint
(`002_initial_core.sql:503` / `:487`). So the design exists on paper, the
vocabulary is already reserved, and the storage was never built.

## 1.5 Defect cluster: all three non-edit hooks are dead, silently

This was found while researching the mechanism and is worth fixing regardless of
which design is chosen.

**(a) The `PermissionRequest` hook calls a subcommand that does not exist.**
`connectors/adapters/claude/scripts/permission-hook.sh` pipes the hook body to
`ovld protocol permission-request`. Probed directly:

```
$ ovld protocol permission-request --mission-id coo:447 --payload-file - <<< '…'
Unknown protocol subcommand: permission-request — Supported subcommands: …
```

`permission-request` is absent from `SUPPORTED_PROTOCOL_SUBCOMMANDS`
(`cli/src/protocol-help.ts:2`). No permission activity has ever reached the feed.
The identical dead call exists in
`connectors/adapters/codex/scripts/permission-hook.sh`.

**(b) The `Stop` hook's hook type is rejected.**
`connectors/adapters/claude/scripts/stop-hook.sh` calls
`ovld protocol hook-event --hook-type Stop`. `recordHookEvent`
(`packages/core/service/protocol.ts:818`) throws for anything but
`UserPromptSubmit`. Probed:

```
$ ovld protocol hook-event --hook-type Stop --mission-id coo:447 --session-key …
Unsupported hook type: Stop — (validation_error)
```

**(c) The same hook then reads a field nobody produces.** It parses
`deliveryStatus.needed` out of the response. `deliveryStatus` appears nowhere in
`backend/`, `packages/`, or `cli/src/`. Even with the hook type accepted, the
pending-delivery guidance would be inert.

**(d) Both are gated on a `MISSION_ID` env var that agent-pod sessions never
set.** This is the exact bug already fixed for `PostToolUse` by the per-cwd
active-session manifest in `cli/src/vcs-sessions.ts` (see its header comment,
lines 7–23). `PermissionRequest` and `Stop` were never migrated to it.

Every one of these failures is invisible: the scripts send stderr to `/dev/null`
and `exit 0`. That is correct for a hook that must never disrupt a user, but it
means the features have been *silently absent* rather than visibly broken.

**Only `PostToolUse` edit capture actually works.** Meanwhile four connectors
declare a `permissionHook` capability in their conformance manifests
(`connectors/adapters/{claude,codex,cursor,antigravity}/conformance-manifest.yaml`),
and `cursor` declares it with no permission hook script present at all. That is a
conformance-manifest accuracy problem as well as a functional one.

## 1.6 Reusable machinery that already exists

The proposal below is mostly assembly, not invention:

| Piece | Where | Reuse |
| --- | --- | --- |
| Postgres `LISTEN` long-poll primitive | `backend/execution/runner-queue-notify.ts` (25 s hold, dedicated non-pooled client, notification-or-timeout) | The blocking wait for a human answer |
| Long-poll response contract | `backend/execution/runner.ts:226-304`, additive `longPoll: boolean` | Same pattern for `ask --wait` |
| Per-cwd active-session manifest | `cli/src/vcs-sessions.ts` | Lets hooks resolve mission + session key with no env var |
| SSE change feed | `GET /api/stream`, `backend/realtime.ts` | Pushes new requests to the webapp |
| Push notifications | `agent_question` category, `enqueuePushNotificationForMission` | Already fires on `ask` |
| Launch env injection | coo:359 `overlord.launchEnvVars` | Can set `BASH_MAX_TIMEOUT_MS`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` per project |
| Revision CAS | house pattern, zero-row update ⇒ `409` | Race resolution between web and terminal |

---

# Part 2 — Agent Client Protocol assessment

## 2.1 What it actually is

| | |
| --- | --- |
| Repo | `github.com/agentclientprotocol/agent-client-protocol` (moved out of the `zed-industries` org) |
| Governance | Jointly governed by **Zed Industries and JetBrains**; two lead maintainers with veto. Explicitly "interim governance," working toward an independent foundation — **no foundation yet** |
| Protocol version | **`1`, stable.** `2` exists as a **Draft**, announced 2026-07-20 |
| License | Apache-2.0 |
| Framing | JSON-RPC 2.0, newline-delimited, UTF-8, fully bidirectional |
| Official SDKs | Rust, TypeScript, Python, Kotlin, Java |

Disambiguation note for anyone reading secondary sources: IBM/BeeAI's *Agent
Communication Protocol* was also abbreviated ACP and was merged into A2A under
the Linux Foundation in August 2025. Several 2026 write-ups conflate the two and
wrongly place Zed's ACP under Linux Foundation stewardship.

**The terminology is inverted from intuition and this matters everywhere:**
the **client** is the editor/IDE/UI (Zed, JetBrains, a hypothetical Overlord
webapp) and the **agent** is the coding agent process, effectively the server.

## 2.2 The disqualifying constraint

> *"The client launches the agent as a subprocess. The agent reads JSON-RPC
> messages from its standard input and sends messages to its standard output."*

stdio is the **only stable transport**. There is no attach, no handshake on
existing file descriptors, no discovery of running agents. The ACP Registry
reinforces this: every entry ships a `distribution` block (usually an `npx`
invocation) whose entire purpose is telling the client *what command to spawn*.

The three session verbs that sound like they might help do not:

| Verb | What it actually does |
| --- | --- |
| `session/list` | Enumerates sessions the agent persisted. Documented as *"a discovery mechanism only — it does not restore or modify sessions."* |
| `session/load` | A **newly spawned** process re-hydrates a session id and **replays the whole transcript** as `session/update` notifications |
| `session/resume` | Same cold re-attach, but MUST NOT replay |

That is cold reattach by id against a fresh process — not live attachment to a
running one. **If a human has `claude` open in a terminal, ACP cannot see it,
cannot inject into it, and cannot mirror it.**

Two further cautions, both material to a build decision:

- **Remote transport is draft.** A Streamable HTTP + WebSocket RFD moved to
  Active on 2026-07-02 and is in reference-implementation phase. Message
  sequencing, `Last-Event-ID` resumability, reconnection semantics, and keepalive
  are all explicitly deferred to v2. In v1, *"reconnect and retry are up to the
  implementer"* and in-flight messages are not replayed.
- **v2 removes v1's main value proposition.** The v2 draft deletes
  `fs/read_text_file`, `fs/write_text_file`, and the entire `terminal/*` family,
  on the rationale that adoption was limited and agents built their own
  sandboxing. Clients wanting specialised tooling are told to expose their own
  MCP server instead. v2 also removes `session/load` and `session/set_mode`,
  makes `session/prompt` return immediately, and replaces chunk updates with
  whole-message upserts.

Separately, ACP *"assumes a single client"*. Microsoft's Agent Host Protocol
exists specifically to add multi-client coordination, server-sequenced ordering,
and reconnect-with-replay on top of ACP, and marks ACP's multi-client story as
"Not addressed." AHP is itself explicitly unstabilised. If the requirement were
"many observers on one session," that is the gap ACP does not fill.

## 2.3 What ACP gets right, and should be borrowed

ACP's `session/request_permission` is, as far as I can find, the only
protocol-level typed approval primitive in this space — MCP, A2A, and AG-UI all
lack one. It is worth copying verbatim:

```jsonc
// params
{ "sessionId": "…", "toolCall": <ToolCallUpdate>, "options": [ <PermissionOption> ] }

// PermissionOption
{ "optionId": "…", "name": "Human label",
  "kind": "allow_once" | "allow_always" | "reject_once" | "reject_always" }

// result — internally-tagged union on `outcome`
{ "outcome": { "outcome": "selected", "optionId": "…" } }
{ "outcome": { "outcome": "cancelled" } }
```

The agent supplies the option list; the client only renders it and returns an
`optionId`. Persisting "always" is the agent's job. This is exactly the shape
Overlord's request rows and permission widgets should use.

The `SessionUpdate` union (`agent_message_chunk`, `agent_thought_chunk`,
`user_message_chunk`, `tool_call`, `tool_call_update`, `plan`,
`available_commands_update`, `current_mode_update`, `config_option_update`,
`session_info_update`, `usage_update`) is likewise a sane, already-standard
vocabulary for feed widget types. Overlord's eleven `mission_events.type` values
are a coarser cut of the same idea.

## 2.4 Where ACP genuinely fits later

Three legitimate, **additive** placements — none of which requires ACP for the
terminal-launched path:

1. **Borrow the data model now (Phase 1).** Use `PermissionOption`'s
   `{optionId, name, kind}` and the four-way kind enum for
   `agent_requests.options_json`. Free interop later, better UX now (a
   "Don't ask again" button falls out of `allow_always`).
2. **An `acp` execution target later (Phase 5, optional).**
   `execution_targets.type` is an **open** vocabulary
   (`CONTRACT.md:633`) documenting `local`, `ssh`, `virtual`. An `acp` target
   would be one where Overlord — the desktop shell, or a virtual-target gateway —
   *is* the ACP client and spawns the agent, with no terminal at all. That is a
   genuinely good fit for mobile-only and cloud execution, and it is an
   **additional** launch mode, not a replacement. Note that under this mode the
   `virtual` target's Virtual Gateway boundary already covers most of the
   plumbing.
3. **Overlord as an ACP agent (out of scope).** Exposing Overlord itself over ACP
   so Zed/JetBrains/Neovim can drive missions is coherent but unrelated to this
   objective.

An ACP adapter for Claude Code does exist and is now co-maintained: the package
chain is `@zed-industries/claude-code-acp` → `@zed-industries/claude-agent-acp` →
**`@agentclientprotocol/claude-agent-acp`** (current, Apache-2.0), and its
dependencies are exactly `@anthropic-ai/claude-agent-sdk` plus
`@agentclientprotocol/sdk`. It therefore drives the **Agent SDK, not the
interactive TUI** — which is another way of restating the constraint: to speak
ACP to Claude Code you must be the one who started it. Its fidelity is
undocumented (the README lists slash commands and MCP as supported and has no
limitations section), so any claim about what it loses needs empirical testing
rather than more reading.

---

# Part 3 — Mechanism inventory

Every candidate channel for getting a human decision into a running agent.
Claude Code schemas here were **extracted from the installed binary**
(`/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`) rather
than taken from documentation, because the docs and the secondary literature
disagree on several fields.

| Mechanism | Works on a terminal-launched session? | Latency | Verdict |
| --- | --- | --- | --- |
| **Blocking `ovld protocol ask --wait`** | **Yes, any harness** | Instant | **Adopt — flagship** |
| **Blocking `PermissionRequest` hook** | **Yes, Claude/Codex/Cursor** | Instant | **Adopt** |
| **`asyncRewake` hook** | **Yes, Claude** | Seconds | **Adopt — fast path for follow-ups** |
| **`Stop` hook `decision:"block"`** | **Yes, Claude** | Next turn boundary | **Adopt — portable backstop** |
| `PostToolUse` `additionalContext` | Yes, Claude | Next tool call | Adopt as an extra drain point |
| MCP tool that blocks | Yes | Instant | Reject — 4-min ceiling, needs the agent to call it |
| MCP `elicitation` + `Elicitation` hook | Yes | Instant | Defer — powerful, but needs an MCP server to initiate |
| `--permission-prompt-tool` | No | — | Reject — print mode only |
| SDK `canUseTool` | No | — | Reject — in-process, SDK must own the subprocess |
| `claude -p --input-format stream-json` | No | Instant | Reject *for this mode*; basis of a future `acp`-style target |
| ACP (stdio) | **No** | — | Reject — client must spawn |
| Claude Code Remote Control `/rc` | Yes | Instant | Cannot build on — see 3.5 |
| AppleScript keystroke injection | Partly | Instant | Reject — see 3.6 |
| tmux `send-keys`, tailing `~/.claude/projects/*.jsonl` | Partly | — | Reject — unsupported, format documented as unstable |

## 3.1 The blocking `ask` — no harness support required

This is the insight that makes the whole feature cheap. When the agent runs
`ovld protocol ask`, **Overlord owns both ends of that call.** The agent is
executing a subprocess and waiting for it to exit. So `ask` can simply not exit:

```
agent ──▶ ovld protocol ask --wait ──▶ POST /api/protocol/ask {wait:true}
                                              │ holds the connection (LISTEN)
   user answers in webapp ──▶ POST /api/agent-requests/:id/resolve
                                              │ NOTIFY wakes the held request
agent ◀── stdout: {"status":"answered","answer":{…}} ◀──┘
```

The answer becomes the Bash tool's result, and the agent reads it as ordinary
output. **No hook, no harness feature, no protocol negotiation.** It works
identically for Claude, Codex, Cursor, Antigravity, Pi, and anything added later,
because the only requirement is "can run a shell command and read its stdout."

Timeout handling: Claude Code's Bash tool defaults to 120 s
(`BASH_DEFAULT_TIMEOUT_MS`) with the ceiling set by `BASH_MAX_TIMEOUT_MS`, both
plain env vars — and Overlord already injects per-project launch env vars
(coo:359 `overlord.launchEnvVars`). Regardless, the server should hold for a
bounded window (~25 s, matching `RUNNER_CLAIM_LONG_POLL_MS`) and return
`{"status":"waiting"}`, with the skill instructing the agent to re-poll. Bounded
holds keep the mechanism portable across harnesses with stricter command
timeouts, rather than betting on one harness's ceiling.

**Graceful degradation is the important property.** If nobody answers within the
overall deadline, `ask --wait` returns `{"status":"timeout"}` and the agent falls
back to exactly today's behaviour: the mission is already parked in review, the
agent stops, and the question sits in the feed. Nothing regresses.

## 3.2 The blocking permission hook

The `PermissionRequest` hook's output schema, extracted verbatim from the
installed binary's Zod definition:

```js
{ hookEventName: "PermissionRequest",
  decision: union([
    { behavior: "allow", updatedInput?: Record<string,unknown>,
                         updatedPermissions?: Array<…> },
    { behavior: "deny",  message?: string, interrupt?: boolean }
  ]) }
```

Note this **corrects the secondary literature**, which commonly reports `rule`
and `rememberRule` fields. Neither exists in this build; the third field is
`updatedPermissions`. `updatedPermissions` is the natural carrier for
`allow_always`.

Hook config entries accept `timeout` (seconds), plus `statusMessage`, `once`,
`async`, `asyncRewake`, and `asyncTimeout`. So the hook can legitimately block
while a human decides, showing a custom spinner message.

Returning a decision **pre-empts the terminal prompt** — Claude Code does not
draw the TUI dialog if the hook resolved it. Conversely, if the hook returns
nothing (timeout), the normal prompt appears. That gives the exact
terminal-stays-authoritative behaviour we want, with no special casing.

Fallback shape:

```
tool call ──▶ PermissionRequest hook
                ├─ publish agent_request(kind=permission) → feed + push
                ├─ long-poll up to N seconds
                │    ├─ resolved in webapp → emit {behavior:"allow"|"deny"}  → no TUI prompt
                │    └─ timeout / not resolved → exit 0, no decision         → normal TUI prompt
```

## 3.3 `asyncRewake` — live injection into an interactive session

The most surprising find. A hook entry may set:

```jsonc
{ "type": "command", "command": "…",
  "async": true, "asyncRewake": true, "asyncTimeout": …,
  "rewakeMessage": "…", "rewakeSummary": "…" }
```

`asyncRewake` is described in the binary as: *"If true, hook runs in background
and wakes the model on exit code 2 (blocking error). Implies async."* On exit
code 2, the hook's **stdout is injected into the model's context as a
system-reminder**, prefixed by `rewakeMessage` (default:
`Stop hook blocking error from command "<name>":`), with `rewakeSummary` shown as
the one-line terminal summary.

So a backgrounded hook that long-polls Overlord's inbound message queue and exits
2 when a message arrives **delivers a user's webapp message into a live,
interactive terminal session, mid-turn.** No stdio ownership, no ACP.

⚠️ **Caveat to weigh before depending on this.** `asyncRewake`, `async`, and
`asyncTimeout` are ordinary fields in the hook config schema, but
`rewakeMessage` and `rewakeSummary` are annotated `@internal` in the binary.
Without them the mechanism still works, but the injected text carries a
misleading "Stop hook blocking error" prefix. Treat `asyncRewake` as a **fast
path that must degrade cleanly**, and keep §3.4 as the portable guarantee.

## 3.4 The `Stop` hook — the portable backstop

Top-level hook output supports `decision: "approve" | "block"` with `reason`.
On `block`, the turn does not end: the runtime sets `stopHookActive: true`,
appends the blocking output to the message list, and continues with transition
reason `stop_hook_blocking`. Consecutive blocks are capped (default 8, raisable
via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`), and the input carries `stop_hook_active`
so a hook can and must yield to avoid a loop.

This gives a guaranteed, well-defined delivery point: **any queued message is
delivered at the next turn boundary at the latest.** Slower than `asyncRewake`
but dependent only on documented fields. `PostToolUse` already runs on every
`Edit|Write|MultiEdit|NotebookEdit|Bash` and supports
`hookSpecificOutput.additionalContext`, so it is a third, free drain point that
tightens latency to "next tool call" without any new hook registration.

## 3.5 Claude Code Remote Control — prior art, not a foundation

Worth naming explicitly because it is the closest shipping implementation of what
this objective asks for, and because someone will ask.

`/remote-control` (or `/rc`) can be invoked **from inside an already-running
interactive session** and carries the current conversation history over; the
remote side can then send input and approve tool calls from a phone. It answers
the requirement almost exactly.

It cannot be Overlord's mechanism:

- **Not a protocol.** Proprietary and Anthropic-relayed. The session registers
  with the Anthropic API and polls for work — outbound HTTPS only, no local
  socket or inbound port for a third party to use.
- **Transcript is stored on Anthropic servers** while connected.
- **Requires claude.ai OAuth.** API keys unsupported; blocked on Bedrock, Google
  Agent Platform, and Microsoft Foundry, and when `ANTHROPIC_BASE_URL` is not
  `api.anthropic.com`. Off by default on Team/Enterprise; incompatible with Zero
  Data Retention.
- **Research preview**, Claude-only, and requires someone able to type `/rc` into
  the session (or pre-enabled auto-connect).

The honest read: it validates the UX, it is single-vendor and unavailable as a
building block, and Overlord's multi-agent, self-hostable positioning needs a
mechanism that works for Codex and Cursor too. It is also a reason **not** to
over-invest in mirroring the full agent transcript — that race is not winnable
and, per Part 4, not the goal.

## 3.6 Rejected: AppleScript keystroke injection

iTerm's scripting API does expose `write text` on a session, and Overlord already
uses it to launch. In principle the desktop shell could type a follow-up into the
pane. Rejected because: the session reference is not retained at launch (§1.1);
it is macOS-and-iTerm/Terminal only, with no story for the generic launcher,
Linux, or Windows; it would fight the user for the input line; and it cannot read
a result back. It is a demo, not an architecture.

---

# Part 4 — Recommended architecture

## 4.1 Design principles

1. **The terminal is always authoritative.** Every request appears in the
   terminal *and* in Overlord. First answer wins; the loser shows who answered.
   Nothing about this feature makes the terminal worse or optional.
2. **Agent-agnostic by default.** The flagship mechanism (§3.1) needs no harness
   feature. Harness-specific mechanisms are additive capability upgrades declared
   in the conformance manifest, so a connector without them degrades to today's
   behaviour rather than breaking.
3. **One primitive, many kinds.** A blocking question, a tool permission, and a
   multiple-choice decision are the same shape: a request with options, awaiting
   a resolution. Do not build three subsystems.
4. **Requests are first-class rows; the feed renders them.** The feed stays the
   mission's record. Interactive affordances live *inside* the widget that owns
   them, driven by request state — not by a parallel chat log.
5. **Every remote path degrades to the status quo.** Timeout, no runner, offline
   agent, unsupported harness: the terminal prompt or today's parked-in-review
   behaviour is always the fallback.

## 4.2 The two new concepts

**`agent_requests` — agent asks, human answers.** A durable, typed,
resolvable request. Covers blocking questions (`kind='question'`), tool
permissions (`kind='permission'`), and structured choices (`kind='choice'`).
Options use ACP's `PermissionOption` shape.

**`agent_messages` — human speaks, agent hears.** An inbound queue of
unsolicited follow-up instructions, drained by the agent's own hooks at the next
available boundary and marked delivered atomically.

The asymmetry is deliberate and reflects reality. A request has a known
recipient that is *actively waiting*, so it can be answered synchronously. A
follow-up message has no waiter, so it is queued and delivered at the next
boundary. Presenting these as the same thing in the UI would be a lie about
latency; presenting them as two clearly-labelled things is honest and still
feels immediate in practice.

## 4.3 Should `permission_requests` be implemented, or superseded?

Recommendation: **supersede it with `agent_requests` in the same contract
version bump that adds the new table**, and retire the never-built
`permission_requests` from the schema contract.

Rationale: `permission_requests` was never created by a migration, so there are
zero rows to migrate and no deployed consumer. Building it as specified and then
adding a near-identical `agent_requests` beside it for questions would leave two
tables modelling one concept. `agent_requests` is `permission_requests` plus a
`kind` discriminator, an options array, and a free-text resolution.

Alternative considered: implement `permission_requests` verbatim for permissions
and add `agent_questions` for questions. Rejected — it doubles the REST surface,
the widget code, and the long-poll plumbing for no benefit, and the two would
drift.

This is a contract decision that needs sign-off, since it edits a documented
(if unbuilt) table out of the schema contract and removes a closed vocabulary.

## 4.4 Data model

```sql
-- Supersedes the documented-but-unbuilt `permission_requests`.
CREATE TABLE agent_requests (
  id                            TEXT PRIMARY KEY,
  workspace_id                  TEXT NOT NULL REFERENCES workspaces(id),
  project_id                    TEXT REFERENCES projects(id),
  mission_id                    TEXT NOT NULL REFERENCES missions(id),
  objective_id                  TEXT REFERENCES objectives(id),
  session_id                    TEXT REFERENCES agent_sessions(id),
  event_id                      TEXT REFERENCES mission_events(id),

  kind                          TEXT NOT NULL,   -- question | permission | choice
  tool_name                     TEXT,            -- permission only
  request_summary               TEXT NOT NULL,   -- secret-redacted, bounded
  payload_json                  JSON NOT NULL,   -- secret-redacted
  options_json                  JSON NOT NULL,   -- [] for free-text questions
  allows_free_text              INTEGER NOT NULL DEFAULT 0,

  status                        TEXT NOT NULL,   -- requested | resolved | expired
                                                 -- | cancelled | superseded
  resolved_option_id            TEXT,
  resolved_text                 TEXT,
  resolved_via                  TEXT,            -- web | mobile | terminal | timeout | rule
  resolved_by_workspace_user_id TEXT REFERENCES workspace_users(id),
  resolved_at                   TIMESTAMP,
  expires_at                    TIMESTAMP,

  created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
  deleted_at TIMESTAMP, revision INTEGER NOT NULL
);
-- (mission_id, created_at), (status, created_at), (session_id, status)

CREATE TABLE agent_messages (
  id                            TEXT PRIMARY KEY,
  workspace_id                  TEXT NOT NULL REFERENCES workspaces(id),
  mission_id                    TEXT NOT NULL REFERENCES missions(id),
  objective_id                  TEXT REFERENCES objectives(id),
  session_id                    TEXT REFERENCES agent_sessions(id), -- null = whoever is live
  body                          TEXT NOT NULL,
  created_by_workspace_user_id  TEXT NOT NULL REFERENCES workspace_users(id),
  status                        TEXT NOT NULL,   -- queued | delivered | expired | cancelled
  delivered_at                  TIMESTAMP,
  delivered_to_session_id       TEXT REFERENCES agent_sessions(id),
  delivered_via                 TEXT,            -- rewake | stop | post_tool_use | ask_response
  created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
  deleted_at TIMESTAMP, revision INTEGER NOT NULL
);
-- (mission_id, status, created_at), (session_id, status)
```

`options_json` entries use ACP's shape verbatim:

```json
[ { "optionId": "allow", "name": "Allow once",     "kind": "allow_once" },
  { "optionId": "always","name": "Always allow",   "kind": "allow_always" },
  { "optionId": "deny",  "name": "Deny",           "kind": "reject_once" } ]
```

Also create the documented-but-missing **`hook_events`** table
(`database/docs/09-database-schema-contract.md:1742`) as part of Phase 0, since
repairing the hooks means they will finally have events to record.

## 4.5 Protocol and REST surface

**New / changed protocol subcommands** (each needs
`contract/protocol-commands.yaml`):

| Command | Change |
| --- | --- |
| `ask` | Add `--wait`, `--timeout-seconds`, `--options-json`. Without `--wait`, behaviour is byte-identical to today |
| `permission-request` | **New** — currently referenced by two connectors and absent. Accepts `--payload-file -`; `--wait` blocks for a decision |
| `hook-event` | Accept `Stop`, `PermissionRequest`, `Notification` in addition to `UserPromptSubmit`; response gains `pendingMessages[]` and the long-promised `deliveryStatus` |
| `messages --drain` | **New** — atomically claim queued `agent_messages` for this session (used by the `asyncRewake` hook) |

`ask --wait` response contract:

```jsonc
{ "requestId": "…", "status": "answered",
  "answer": { "optionId": "…", "text": "…", "resolvedBy": "jake", "resolvedVia": "web" },
  "pendingMessages": [ … ] }          // ride-along drain
{ "requestId": "…", "status": "waiting" }   // bounded hold elapsed; re-poll
{ "requestId": "…", "status": "timeout" }   // deadline passed; fall back to today
```

**New REST routes** (all authorized against the mission's owning workspace via
the existing resource-derived pattern):

| Route | Purpose | Permission |
| --- | --- | --- |
| `GET /api/missions/:id/agent-requests` | List, `?status=requested` | `mission:read` |
| `POST /api/agent-requests/:id/resolve` | `{ optionId?, text? }`, revision CAS | new `mission:respond` |
| `POST /api/agent-requests/:id/cancel` | Withdraw | `mission:respond` |
| `POST /api/missions/:id/messages` | Queue a follow-up instruction | `mission:respond` |
| `GET /api/missions/:id/messages` | Show queued/delivered state | `mission:read` |

A distinct `mission:respond` permission is proposed rather than reusing
`mission:update`, because answering a permission prompt authorizes an agent to
take an action on a developer machine. That should be grantable separately from
editing mission metadata. Needs RBAC sign-off.

**Race resolution** is a single CAS: `UPDATE agent_requests SET status='resolved'
… WHERE id=? AND status='requested' AND revision=?`. Zero rows ⇒ `409`, and the
widget flips to "Answered in terminal." The held long-poll is woken by `NOTIFY`
on a new channel alongside `overlord_execution_request_queue`.

## 4.6 Interaction with `ask`'s current side effects

Today `ask` moves the mission to review (§1.3). With `--wait` that is wrong while
the agent is still blocked and reachable. Proposal:

- `ask --wait` writes the `ask` event and the `agent_requests` row, fires the
  existing `agent_question` push, and puts the objective in a **blocked-but-live**
  presentation — it does **not** move the mission to review yet.
- On answer: resolve, append an `answer` event, resume normal `execute` phase.
- On overall timeout or agent death: fall through to today's
  `moveMissionToReview`, so the parked state is reached by the same path as now.

This keeps the mission board honest: "waiting on a human, agent still alive" is a
genuinely different state from "agent stopped, needs review," and the board
already distinguishes blocked.

---

# Part 5 — UI: widgets, not a chat pane

## 5.1 Recommendation: redesign the feed; do not add a separate chat surface

The objective floated both. Recommend **one surface**: keep the activity feed as
the single mission narrative, upgrade its entries to interactive widgets, and pin
one composer beneath it.

Reasons:

1. **The feed already is the transcript.** Two surfaces would diverge, and the
   user would have to check both to know what happened.
2. **A "chat" would look broken.** Overlord will never hold the agent's full
   conversation — that lives in the terminal, and per §3.5 the only product that
   mirrors it is Anthropic's own cloud relay. A chat UI implies completeness the
   data cannot deliver. A feed of significant events plus a composer promises
   exactly what it delivers.
3. **Widgets + composer already covers 100% of the requested capability**:
   answer questions, approve permissions, send follow-ups.
4. It is what the objective's own instinct pointed at — *"expand on what have
   essentially become activity feed widget types."* That instinct is right.

## 5.2 Replace the boolean branches with a widget registry

The current three-boolean, ternary-class-chain structure (§1.2) will not survive
two more interactive types. Replace it:

```ts
type ActivityWidget = {
  icon: LucideIcon | null;
  label: string;
  tone: 'neutral' | 'user' | 'attention' | 'positive' | 'negative';
  /** Richer body; falls back to ExpandableSummary. */
  Body?: ComponentType<{ event: MissionEventDto; missionId: string }>;
  /** Interactive footer, rendered only while the owning request is actionable. */
  Action?: ComponentType<{ event: MissionEventDto; missionId: string }>;
};

const ACTIVITY_WIDGETS: Record<MissionEventType, ActivityWidget> = { … };
```

`tone` collapses the scattered colour ternaries into one lookup, and unknown
future types keep the existing neutral-dot fallback (`eventMeta`,
`LiveActivityFeed.tsx:51`) so the client never breaks when the server vocabulary
grows ahead of it.

| Widget | Body | Action |
| --- | --- | --- |
| `ask` | question text | **Reply field + option buttons**, live countdown, "Answered in terminal" terminal state |
| `permission_request` | tool name + redacted summary | **Allow once / Always allow / Deny** from `options_json`, countdown |
| `delivery` | existing `DeliveryExpandable` | open delivery record |
| `user_follow_up` | avatar + text (exists) | — |
| `agent_message` (new) | queued instruction + delivery state | Cancel while `queued` |
| `update`, `alert`, `decision`, `discussion_summary`, `status_change`, `execution_requested`, `awaiting_approval` | `ExpandableSummary` | — |

Actions render from the **`agent_requests` row**, not from the event. The event
is the immutable record; the request row carries the mutable status. That is why
an answered question can keep its history entry while the buttons disappear.

## 5.3 The composer

Pinned at the foot of the Activity section (`MissionPanel.tsx:358-367`), enabled
only when the mission has a live session. It must be **honest about latency** —
this is the part most likely to be got wrong:

- No live session → disabled, "No agent is running. Queue this as a new
  objective instead."
- Live session, harness supports `asyncRewake` → "Delivered to the agent."
- Live session, `Stop`-only harness → "Queued — the agent will see this when it
  finishes its current step."
- Delivered → the queued widget flips to a `user_follow_up`-styled entry.

Reuse `MentionableTextarea` / `RepositoryMentionTextarea`
(`webapp/web/components/`) so `@`-mentions and repository references behave as
they do elsewhere.

## 5.4 Mobile

The push side is already built: coo:444 ships an `agent_question` category
enqueued from `askQuestion` itself, with a deep link and a strict
payload-privacy rule (question text never leaves the database). Two additions:

1. A `permission_request` notification category — needs a contract bump, since
   `notification_preferences` categories are a closed set of four
   (`CONTRACT.md:468`).
2. **iOS actionable notifications** (`UNNotificationAction`) for allow/deny and a
   text-input action for answering a question, hitting the same
   `POST /api/agent-requests/:id/resolve`. This is where remote answering pays
   off most — approving a command from a phone is the canonical use case.

Payload privacy must hold: the notification carries the request id and category,
never the tool input, command text, or question body. The client fetches detail
over the authenticated API after unlock.

---

# Part 6 — Phasing

Ordered so each phase is independently shippable and useful.

**Phase 0 — Repair (small, do regardless).** Add the missing
`permission-request` subcommand; accept `Stop`/`PermissionRequest` in
`recordHookEvent`; produce the `deliveryStatus` the Stop hook already parses;
migrate both hooks off the `MISSION_ID` gate to `cli/src/vcs-sessions.ts`; create
the `hook_events` table; make hook failures observable in `~/.ovld/logs` instead
of `/dev/null`; correct the connector conformance manifests. **Outcome: permission
activity finally appears in the feed** — read-only, but real.

**Phase 1 — Answerable questions (highest value / lowest risk).**
`agent_requests`; `ask --wait` with bounded long-poll; the resolve route; the
question widget with an inline reply field. No harness dependency at all.
**Outcome: the `agent_question` push notification stops being a dead end.**

**Phase 2 — Remote permission approval.** Make the `PermissionRequest` hook
blocking with fallthrough to the terminal prompt; permission widget with the
four ACP option kinds; `updatedPermissions` for `allow_always`. New connector
capability flag. **Outcome: approve a command from the couch.**

**Phase 3 — Follow-up messages.** `agent_messages`; the composer;
`messages --drain`; `asyncRewake` hook as fast path with the `Stop` hook and
`PostToolUse` `additionalContext` as backstops. **Outcome: steer a running agent
without the terminal.**

**Phase 4 — Feed redesign + mobile.** The widget registry refactor (worth doing
after two interactive widgets exist, so the abstraction is derived rather than
guessed); actionable iOS notifications; `permission_request` push category.

**Phase 5 — Optional: `acp` execution target.** Overlord-as-ACP-client for
headless/cloud/mobile-only execution, where there is no terminal to preserve.
Additive; revisit once the ACP v2 draft settles, given it removes `fs/*` and
`terminal/*`.

---

# Part 7 — Contract impact

Per `CONTRACT.md:680`, the contract must be updated **before** implementation.
Anticipated changes, requiring a version bump to `30`:

| Change | Contract artifact |
| --- | --- |
| New tables `agent_requests`, `agent_messages`, `hook_events` | `database/docs/09-database-schema-contract.md`, `10-database-table-groups.md` |
| Retire unbuilt `permission_requests` + its closed vocabulary | schema contract + `CONTRACT.md` closed vocabularies |
| New closed vocabularies `agent_requests.kind`/`.status`/`.resolved_via`, `agent_messages.status`/`.delivered_via` | `CONTRACT.md`, `contract/extension-points.yaml` |
| New `mission_events.type` values (`answer`, `agent_message`) | closed vocabulary ⇒ bump |
| New protocol subcommands + flags | `contract/protocol-commands.yaml` |
| New "Human → Agent (Response Surface)" interaction surface | `CONTRACT.md` Interaction Surfaces |
| Extend Connector → Protocol hook surface: hooks may now **block and return a decision** | `CONTRACT.md:415` |
| New connector capability flags (e.g. `blockingPermissionHook`, `inboundMessages`) | `approvedConnectorCapabilities`, `contract/extension-points.yaml:144` |
| New hook type `Notification` if adopted | `approvedHookTypes`, `contract/extension-points.yaml:158` |
| New `mission:respond` RBAC permission | `overlord.rbac.toml`, `auth/src/rbac/` |
| New push category `permission_request` | `notification_preferences` closed set |

The **blocking-hook change is the most significant contract edit.** Today the
hook surface is documented as fire-and-forget notification
(`CONTRACT.md:415-422`). Allowing a hook to block on a network round-trip and
return an authorization decision changes its risk profile: a hung backend could
stall a developer's agent. Mandatory rules to write into the contract:

- Every blocking hook declares a hard local timeout and **falls through to the
  harness's own prompt** on timeout, error, offline backend, or missing session.
- A hook must never block a tool call it cannot resolve.
- Failure is always permissive-to-the-terminal, never permissive-to-the-agent: a
  timeout yields *"ask the human at the keyboard,"* never *"allow."*

---

# Part 8 — Risks and open questions

**Risks**

| Risk | Mitigation |
| --- | --- |
| A blocking hook stalls the agent when the backend is unreachable | Hard local timeout well under the hook timeout; fall through to the TUI prompt; never fail open |
| `asyncRewake` / `rewakeMessage` are version-sensitive (`@internal`) | Treat as fast path only; `Stop` + `PostToolUse` are the portable guarantee; feature-detect and degrade |
| Web and terminal answer simultaneously | Single revision CAS; loser gets `409` and a "answered in terminal" state |
| A queued follow-up lands after the agent has moved on | Show queued-vs-delivered honestly; expire stale messages; allow cancel while `queued` |
| Redacting permission payloads | Reuse the coo:444 bounded-sanitizer discipline; store redacted, never echo raw tool input to push |
| Remote approval as a security regression | Separate `mission:respond` permission; audit-log every resolution with actor and `resolved_via` |
| Scope creep toward mirroring the whole transcript | Explicit non-goal (§5.1) |

**Open questions for the PM**

1. **Retire `permission_requests`, or implement it as documented?** (§4.3 — I
   recommend retire-and-supersede, but it edits the schema contract.)
2. **Is a separate `mission:respond` permission right,** or should answering
   reuse `mission:update`?
3. **Should remote approval be opt-in per project or per workspace?** Some teams
   will consider phone-approved `rm -rf` unacceptable regardless of RBAC.
4. **How long should a request stay answerable?** `expires_at` needs a default;
   an hour-old permission prompt for a long-dead tool call is a footgun.
5. **Codex / Cursor / Antigravity parity.** Phase 1 works everywhere. Phase 2
   depends on each harness's permission-hook return contract, which I have not
   verified outside Claude Code. Worth a spike before committing Phase 2 to a
   contract version.

---

# Appendix — Verified schema extracts

Extracted from the installed Claude Code build
(`/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`) on
2026-07-26, not from documentation. Where these disagree with published or
secondary sources, they reflect the build actually running in this environment
and should be re-verified against the version Overlord targets at
implementation time.

**Hook config entry fields:** `type`, `command`, `timeout` *(seconds)*,
`statusMessage`, `once`, `async`, `asyncRewake`, `asyncTimeout`,
`rewakeMessage` *(@internal)*, `rewakeSummary` *(@internal)*.

**`hookSpecificOutput` union members present in this build:** `PreToolUse`,
`UserPromptSubmit`, `UserPromptExpansion`, `Setup`, `SubagentStart`,
`PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Stop`, `SubagentStop`,
`PermissionDenied`, `Notification`, `PermissionRequest`, `Elicitation`,
`ElicitationResult`, `CwdChanged`, `FileChanged`, `WorktreeCreate`,
`MessageDisplay`.

**Top-level hook output fields:** `continue`, `suppressOutput`, `stopReason`,
`decision` (`"approve" | "block"`), `reason`, `systemMessage`,
`terminalSequence`, `hookSpecificOutput`.

```js
// PermissionRequest — the remote-approval channel
{ hookEventName: "PermissionRequest",
  decision: union([
    { behavior: "allow", updatedInput?: Record<string,unknown>,
                         updatedPermissions?: Array<…> },
    { behavior: "deny",  message?: string, interrupt?: boolean } ]) }

// PreToolUse — fires earlier; can hard-deny
{ hookEventName: "PreToolUse",
  permissionDecision?: "allow" | "deny" | "ask" | "defer",
  permissionDecisionReason?: string,
  updatedInput?: Record<string,unknown>,
  additionalContext?: string }

// Stop / PostToolUse — injection points
{ hookEventName: "Stop",        additionalContext?: string }
{ hookEventName: "PostToolUse", additionalContext?: string,
  updatedToolOutput?: unknown, updatedMCPToolOutput?: unknown }

// Elicitation — resolves an MCP elicitation before the TUI sees it
{ hookEventName: "Elicitation",
  action?: "accept" | "decline" | "cancel",
  content?: Record<string,unknown> }
```

**Stop-hook blocking:** `stop_hook_active` on input; runtime sets
`stopHookActive: true` and continues with transition reason
`stop_hook_blocking`; consecutive-block cap defaults to 8, raisable via
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`.

**Relevant env vars:** `BASH_DEFAULT_TIMEOUT_MS` (120000),
`BASH_MAX_TIMEOUT_MS`, `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (8).

**`asyncRewake`, verbatim:** *"If true, hook runs in background and wakes the
model on exit code 2 (blocking error). Implies async."* `rewakeMessage` is the
*"Custom prefix for the system-reminder shown to the model when an asyncRewake
hook exits with code 2. The hook output is appended after this prefix."*
