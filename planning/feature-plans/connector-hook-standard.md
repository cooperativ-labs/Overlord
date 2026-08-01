# Connector Interaction Core

Status: proposed. Companion to
[agent-interaction-acp.md](./agent-interaction-acp.md), which describes the
backend Agent Session Exchange, and to
[connector-harness-taxonomy.md](./connector-harness-taxonomy.md), which
describes how each specific harness is adapted to this core.

> **On the filename.** This document keeps the name `connector-hook-standard.md`
> for link stability, but its title changed for a reason that matters. The first
> draft was written against Claude Code and assumed every connector integrates
> through blocking subprocess hooks. Surveying four more harnesses proved that
> assumption wrong: two of the five do not use hooks at all. "Hook" is one
> integration shape among three, so the core is defined in terms of an adapter
> interface rather than a hook contract.

This document describes the **harness-agnostic core**: the rules, the data
model, and the adapter interface that do not know or care which agent is
running. Everything that names a specific harness belongs in the taxonomy
document or in that harness's folder under `connectors/adapters/`.

---

## 1. The split

The dividing line is a single test:

> **If a change to one harness's release notes could invalidate the statement,
> it is not core.**

| Core owns                                                  | Adapter owns                                            |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| The three invariants (§3)                                  | How the native session id is obtained                   |
| Session binding storage and lookup                         | Which native events map to which normalized event       |
| The normalized event envelope and answerable-request model | Native decision-shape emission                          |
| Decision-window policy and presence sizing                 | Native timeout ceiling and how the wait is held open    |
| Request presentation, surfaces, and revision CAS           | Whether a native prompt exists to fall back to          |
| Description synthesis and redaction (§9)                   | Tool-name and tool-input normalization for that harness |
| Capability grading and conformance tiers                   | The capability vector this connector actually declares  |
| Every network call to the backend                          | Zero network calls                                      |

Two consequences follow immediately, and both are load-bearing:

- **Adapters never talk to the backend.** An adapter translates and hands off to
  the CLI, which owns transport, auth, retry, and redaction. This is the reason
  one privacy review covers five connectors instead of five reviews covering
  one connector each.
- **The core contains no harness conditionals.** There is no
  `if (agent === 'claude')` in core. A harness that needs different behavior
  declares a different capability vector, and the core branches on the
  capability, never on the name. When this rule is broken, the sixth connector
  is the one that reveals it, and by then the branches are load-bearing.

---

## 2. Three integration shapes

The five surveyed harnesses integrate in three structurally different ways. The
core's job is to be indifferent to which.

| Shape                        | Where our code runs                       | How a decision is returned                    | Harnesses             |
| ---------------------------- | ----------------------------------------- | --------------------------------------------- | --------------------- |
| **A — blocking callback**    | A subprocess the harness spawns per event | JSON on stdout before the harness proceeds    | Claude, Codex, Cursor |
| **B — in-process extension** | Inside the agent process, as a module     | A resolved promise from an event handler      | Pi                    |
| **C — control-plane client** | Beside the agent, as a client of its API  | An HTTP call against the harness's own server | OpenCode              |

The differences that actually reach the core are these:

- **Shape A cannot observe and decide at the same time.** The harness's own
  prompt is drawn only after our callback returns. Holding the callback open is
  the only way to pre-empt it, and returning is a one-way handoff.
- **Shape B can hold a decision open without blocking a process**, and can
  additionally push input into a live turn, because it is inside the event loop
  rather than beside it.
- **Shape C has no handoff at all.** Overlord and the harness's own UI are peers
  on one event bus, both subscribing and both able to answer. Nothing is
  released, because nothing was ever exclusively held.

That last point retires a piece of complexity that the earlier draft treated as
universal. The remote-decision window, presence sizing, and release-to-terminal
handoff described in [agent-interaction-acp.md](./agent-interaction-acp.md) are
**Shape A and B mechanisms**. They exist to work around the fact that a callback
can be held or released but not shared. Under Shape C, "first answer wins" is
literally true and needs no window. The core must therefore treat the window as
a capability-gated policy, not as the way answering works.

---

## 3. The three invariants

Every connector, in every shape, obeys these. Nothing below is negotiable per
harness.

1. **A verified session channel credential is the only thing that authorizes an
   agent event and scopes it to a mission.** The native session id is a
   *correlation alias* — the key that says "these events came from the same
   harness session" — and nothing more. Never the working directory, never an
   environment variable alone, never timing, never "the most recently attached
   mission," and never a native id somebody merely possesses.
2. **No binding means no Overlord.** The adapter exits or ignores the event
   immediately, does nothing observable, and the harness behaves exactly as it
   would with Overlord uninstalled.
3. **The harness's own behavior is the floor.** Overlord may pre-empt a native
   prompt when it can answer first; it may never remove the native prompt, and
   no failure path may manufacture an approval.

### 3.0 Correlation is not authorization

This invariant was originally written as "the native session id is the only key
that binds an event to a mission," and that phrasing was wrong in a way worth
naming, because the design it feeds
([agent-interaction-acp.md](./agent-interaction-acp.md)) already separates the
two concerns.

| Concern                                  | Answered by                                          |
| ---------------------------------------- | ---------------------------------------------------- |
| "Which harness session produced this?"   | The native session id — a lookup alias               |
| "Is this event allowed, and whose is it?" | The verified channel/session credential              |
| "Which project is this checkout?"        | The working directory — and nothing else             |

A native session id is a value the harness prints, logs, and passes to
subprocesses. Treating possession of one as proof of scope would let anything
that can read a log write into someone else's mission feed. So the channel — an
`agent_session_channels` row created before launch and bound to
`agent_sessions.id` at protocol `attach` — plus its short-lived, hash-stored,
channel-scoped credential is the authority. The credential can affect exactly
one channel; it cannot read mission context and cannot resolve a human decision.

Three consequences follow:

- **Cwd may locate, never create or authorize.** The working directory can help
  find an existing local binding for a session that already has one. It can
  never establish a binding, and it never makes an event in scope.
- **`ovld agent-session bind` requires a credential**, either the active session
  key or the channel credential. Possession of a native id alone never permits
  binding or rebinding.
- **Pre-attach events are not orphans.** They attach to the channel and become
  session events when binding completes, so a harness that only reveals its
  session id on the first event does not lose that window — and does not need a
  cwd guess to cover it.

"Short-lived" means revocable with the channel, not "expires halfway through a
healthy long-running agent": the server extends the credential's bounded expiry
with the channel lease and revokes it on `ended`/`lost` or at an absolute
lifetime ceiling.

### 3.1 Why binding is not the working directory

Working-directory resolution (`resolveActiveMissionForCwd`,
`cli/src/vcs-sessions.ts:125`) answers "which project is this?" It cannot answer
"which session is this?", and every decision here is session-scoped.

Concretely: with a mission attached in a repository, a second unrelated agent
session started in that same repository matches the manifest and is treated as
in scope. Its permission requests route to a mission it has nothing to do with.
Silent misattribution is strictly worse than falling back to the native prompt,
because the native prompt is a correct outcome and misattribution is not.

### 3.2 Binding fallback order

1. **Native session id read from the environment of the `attach` subprocess.**
   The normal path. The agent runs `ovld protocol attach` as a tool call, so if
   the harness exports its session id into tool subprocesses, attach reads it
   from its own environment and binds synchronously — no adapter involved, and
   no window in which the session is attached but unbound.
2. **Native session id from an adapter-observed event**, for harnesses that do
   not export it. The binding is written by the first event that fires with a
   resolvable mission, which means a short unbound window is unavoidable and
   must be treated as normal rather than as an error.
3. **Native session id from the harness's own API**, for Shape C, where the
   adapter can enumerate live sessions directly.
4. **No binding.** No-op. **There is no cwd fallback for gating.**

Every step above resolves *correlation*. In each case the event is authorized by
the channel credential the launch (or an authenticated attach) provided; the
native id only says which channel to attribute it to.

Environment variables such as `MISSION_ID` (`cli/src/launch.ts:86`) remain
useful for resolving _which mission_ when writing a binding. They are never
sufficient on their own to decide that an event is in scope, because they say
nothing about which session produced it.

### 3.3 Binding lifecycle

- **Mutable.** One terminal session may attach, deliver, and attach again. Last
  write wins, with history retained.
- **Re-established on resume and fork.** Resume usually spawns a new process and
  re-binds at the next attach. In-process forks are the hazard: whether a fork
  mints a new native session id is a per-harness question, and getting it wrong
  routes a forked session's requests to the parent's mission.
- **Observable.** A missing binding fails as silence — the feed simply stays
  empty. `ovld doctor` must therefore report which integration is installed, at
  what scope, and which mission the current native session is bound to.
- **Subagents are a decision, not a discovery.** Whether a subagent's events
  carry the parent session id or their own must be established per harness. If
  their own, subagent requests are unbound and fall to the native prompt. That
  may be an acceptable answer; it may not be discovered by accident.

---

## 4. The scope gate and its ordering invariant

Overlord installs connector integrations **user-globally**. Every registered
hook, extension, or watcher is therefore active in **every session that user
runs on that device** — personal projects, client work, unrelated repositories.
A tool matcher narrows which _tool calls_ trigger an integration; it never
narrows which _sessions_.

> **An adapter resolves scope before it does anything else** — before logging,
> before spawning an interpreter, before any network call, before writing
> anywhere outside its own resolution cache.

Three reasons, in increasing order of severity:

- **Availability.** A backend outage must never be able to block unrelated work.
- **Latency.** A round trip on every permission prompt in every session on the
  machine is not acceptable overhead.
- **Privacy.** Payloads carry tool inputs and, for prompt events, the user's
  prompt text. Transmitting before the gate means exfiltrating content from
  repositories that have nothing to do with Overlord. This is why the rule is an
  invariant rather than an optimization.

For Shape C the gate moves but does not weaken: the adapter is a separate
process that only ever connects to a harness endpoint Overlord itself launched
and recorded, and it enumerates only the sessions belonging to that instance.

---

## 5. The adapter interface

An adapter implements this and nothing more. Every function is synchronous with
respect to the harness's expectations and asynchronous with respect to ours.

```
bind()      -> { nativeSessionId } | null
              Resolve the native session identity for this event or process.
              Must be cheap and must never touch the network.

observe(e)  -> NormalizedEvent | null
              Translate one native event into the core envelope. Returning null
              means "not interesting", which is the correct answer far more
              often than not.

present(r)  -> void
              Hand an answerable request to the core. The core decides which
              surfaces it reaches and owns the request row.

resolve(d)  -> NativeDecision
              Render a core decision in the harness's exact native shape. The
              only function in the system permitted to know that shape.

inject(m)   -> Delivered | Queued | Unsupported
              Push an instruction into the live session, honestly reporting
              which of the three actually happened.

capabilities() -> CapabilityVector
              What this connector can really do, verified by fixture.
```

Rules that apply to all five:

- **`resolve` emits the harness's exact decision shape, never a normalized
  Overlord shape.** Harnesses differ in enum values, in field names, and in
  which fields are tolerated. Normalizing outbound is how a connector silently
  stops working after an upstream release.
- **`resolve` must fail toward the harness.** Timeout, backend error, missing
  binding, auth failure, malformed response — every one returns _no decision_,
  which yields the native prompt. There is no failure path that grants
  permission.
- **`inject` must not lie.** `Delivered` means the agent has the message.
  `Queued` means it will get it at a boundary we can name. `Unsupported` is a
  perfectly good answer and is better than a hopeful `Queued`. The Exchange's
  delivery state machine is only honest if adapters are.
- **`observe` must not block.** Observation is never worth a stalled session.

---

## 6. Event classification

Exposure is uniform across events; blast radius is not. Classify before
registering.

| Class                | Examples                                         | Failure cost                | Rules                                                                   |
| -------------------- | ------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| **Observational**    | tool completion, prompt submitted, session start | Milliseconds; privacy leak  | Must not block. Must gate before any I/O. Failures never surface.       |
| **Decision-capable** | permission request, pre-tool, stop               | Alters an unrelated session | All of the above, plus §7. Requires an explicit capability declaration. |

Stop-class events deserve specific caution: continuing a session the user
believed had finished is a bigger surprise than any hang. Hanging is at least
legible; silently resuming someone's unrelated agent is not.

---

## 7. Holding a decision open

For Shapes A and B, holding is the mechanism that makes remote answering
possible and the single largest risk in the design. A held decision that misfires
outside its mission stalls an unrelated session for the length of its timeout.

1. **Gate first, hold second.** Never hold before the binding check. An unbound
   session returns in milliseconds.
2. **Bound the wait strictly below the harness's own ceiling**, so the harness
   never aborts the wait out from under us and leaves the request in an
   unknowable state. The ceiling is a per-harness fact; the margin is core
   policy.
3. **Size the window by human presence, not by a constant.** A short window when
   local input activity was seen recently; a long one when it was not or when no
   presence source exists; extension to the long window as soon as a remote
   client opens the request. For an absent user, releasing to the native prompt
   is strictly worse than waiting, because the native prompt blocks the agent
   until they return anyway and the release destroys the only channel that could
   have unblocked it.
4. **Local activity is a release trigger, not only an initial input.** An
   idle-to-active transition releases the request so the native prompt appears
   promptly. Touching the machine collapses the window; that is the whole
   terminal-first story, and it is better than a fixed terminal-first delay
   because it responds to what the human is actually doing.
5. **A local interrupt is cancellation, never approval.** A late remote answer
   is rejected by revision CAS.
6. **`window = 0` is a supported project setting.** Anyone who wants
   unconditional terminal-first behavior gets it as configuration rather than as
   a reversed default.

**Shape C skips all of this.** There is no held callback, so there is no window,
no release, and no presence input. The core must gate items 2 through 5 on a
capability, not apply them universally.

---

## 8. Presenting an answerable request

One event creates one request, presented on every surface available at the time,
all backed by the same row, with the race settled by revision CAS. Because all
of these surfaces are Overlord's, first-answer-wins is straightforwardly correct
between them.

| Surface             | Availability                      | Notes                                                      |
| ------------------- | --------------------------------- | ---------------------------------------------------------- |
| Web / mobile        | Always, when the session is bound | The reason the feature exists                              |
| Companion pane      | Where the launcher can split      | `cli/src/terminal-launcher.ts:273` already supports splits |
| Any second terminal | Always                            | `ovld requests`, resolving without arguments               |
| Native prompt       | Per §3 invariant 3                | The floor, reached by release or by any failure            |

Under Shape A the native prompt **cannot** participate concurrently — it is
drawn only after the callback returns. Under Shape C it participates fully and
is just another peer. This is the sharpest observable difference between the
shapes and the UI should not pretend otherwise.

### 8.1 `ovld requests`

Resolution with no arguments, in order: native session id from the environment
if present; then the per-cwd manifest; then the backend, listing open requests
for the authenticated user on this device. A fresh process owns its own tty, so
it may render a full interactive UI safely.

Naming matters: not `ovld approve`, which reads as though it performs an
approval. `ovld requests` also covers blocking questions, not only permissions.

### 8.2 Never write to the agent's own terminal

A subprocess inherits the controlling terminal and could open `/dev/tty`. It
must not. The harness holds that tty in raw mode with its own reader running;
two readers split keystrokes nondeterministically, and writes interleave with
the harness's repaint. Use an adjacent pane or a separate process.

Where a harness offers a supported way to write status into its own UI — a
spinner label, a toast — use that instead, and treat it as an adapter detail.

---

## 9. What leaves the machine

**Unbound sessions transmit nothing.** The gate in §4 runs before any network
call, so an event in a session with no Overlord binding produces no request, no
event, and no database row. This is the single most important privacy property
in the design, and it is why the gate is an invariant rather than an
optimization.

For **bound** sessions, raw native payloads are never persisted. They carry far
more than Overlord needs, and some of it is the most sensitive content on the
machine: full command lines, entire file contents, entire command output, and a
path to the complete conversation transcript.

The adapter reduces every payload **on the machine**, before transmission:

| Persisted                                       | Not persisted                              |
| ----------------------------------------------- | ------------------------------------------ |
| Native session id, for correlation              | Transcript paths, and never transcripts    |
| Normalized tool name                            | Raw tool input                             |
| A bounded, redacted human-readable summary      | Raw tool output or command output          |
| Option ids and labels for the response contract | File contents from write and edit payloads |
| Timestamps, status, resolver attribution        | Environment variables, credentials, tokens |
| Repo-relative paths where a path is the subject | Absolute paths outside the project         |

Two consequences worth stating plainly:

- **The summary is synthesized, not forwarded.** No surveyed harness provides a
  human-readable description of what it is asking; there is only a tool name and
  raw input. The card a user sees is something the adapter constructs, which is
  precisely why reduction happens adapter-side. Sending the raw payload for the
  server to summarize would defeat the entire property.
- **Prompt capture is the deliberate exception.** Follow-up prompt text is
  persisted in full for bound sessions, because the activity feed exists to show
  it. That is intentional, but it is the one place raw user content flows and it
  belongs in privacy documentation rather than being discovered.

Push payloads are stricter still: no tool names, no command text, no question
text — an identifier and a category only, with content fetched by the client
after authentication.

### 9.1 Synthesizing the description

**This is a security-relevant string.** A person who approves `rm -rf` because
the card said "clean up temporary files" has been failed by our own feature. The
description must be _derived_, never generated.

An LLM is rejected on every axis: it needs network access from inside a held
decision, which defeats the property §9 exists to protect; it adds latency to
something already blocking; it costs money on every permission prompt; and it
can be wrong in exactly the direction that causes harm. Deterministic formatters
are also testable, which a summarizer is not.

Each formatter emits a small record rather than a string, so mobile can render
terse and web can render full:

| Field          | Contents                                                      |
| -------------- | ------------------------------------------------------------- |
| `action`       | Short verb phrase — "Run a shell command", "Overwrite a file" |
| `subject`      | Repo-relative path, or program name                           |
| `detail`       | Bounded, redacted specifics                                   |
| `risk_markers` | Machine-derived flags                                         |

`risk_markers` is what makes remote approval viable at all. Nobody audits a
200-character command on a phone. But `outside-project-directory`,
`network-egress`, `sudo`, `destructive`, `irreversible`, and `secret-adjacent`
are decidable at a glance and are derived from structure rather than prose. They
are the difference between a card that asks for trust and one that supports a
judgment.

**Formatters are keyed by normalized tool name, in core.** Normalization is the
adapter's job, because the same conceptual tool has different names and
different input shapes in every harness — `Bash` in one, `bash` in another,
`Shell` in a third, `shell_command` in a fourth. Core owns the formatter;
adapters own the mapping into it.

| Normalized tool | Emits                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shell`         | Program from argv0, truncated command; markers for `sudo`, `rm -rf`, `curl`/`wget`/`nc`, `git push --force`, redirects outside the repo, pipe-to-shell |
| `write`/`edit`  | Repo-relative path, byte count, create-vs-overwrite. **Never the content**                                                                             |
| `read`          | Path only                                                                                                                                              |
| `fetch`         | Scheme, host, path — **query string stripped**, since query params routinely carry tokens                                                              |
| `mcp`           | Server and tool name, plus input key names only                                                                                                        |

**The default rule is structure, never values.** An unknown tool emits its name
and the **top-level keys** of its input, and nothing else. Key names are
structural; values are content. Only a formatter written explicitly for a tool
may emit any value from that tool's input. This matters because harnesses add
tools faster than we will write formatters, and default-deny on values means a
new tool leaks nothing until someone deliberately decides what is safe to show.

Two failure modes to design against:

- **Tool input is model-controlled.** A model can craft input whose _rendering_
  misleads — embedded newlines or markup that make a destructive command's card
  read as benign. So `action` and `risk_markers` are derived by the formatter and
  never copied from model-controlled text; cards render as plain text with
  control characters escaped, never as Markdown or HTML; and truncation is always
  explicitly marked, never silent.
- **Formatter failure must not fail dangerous.** A formatter that throws falls
  back to the generic structural card — tool name plus key names. It never falls
  back to raw passthrough, and it never fails the decision.

Stored output carries a `formatter_version` so a request stays interpretable
after the formatter changes. Golden-fixture tests are required per tool,
including adversarial cases: embedded newlines and control characters, unicode
homoglyphs in paths, arguments long enough to force truncation, and inputs
constructed so a destructive action renders as a benign one.

**The honest limit.** The card is a **decision surface, not an audit surface**.
The exact thing being approved stays on the machine, and the native prompt is
where it can be inspected in full. The UI should say plainly that it is showing
a summary, and should offer deferring to the terminal as a first-class choice.

---

## 10. Capability grading and conformance tiers

The core branches on capabilities. A connector's tier is the highest one whose
every capability it demonstrates with a fixture — claimed-but-unproven is worse
than absent, because the UI renders controls that do nothing.

| Tier | Name           | Requires                                                              | User-visible result                                   |
| ---- | -------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| 0    | Unsupported    | Nothing                                                               | Mission works; no session interaction                 |
| 1    | Observational  | Binding + at least one normalized event                               | The feed shows what happened, read-only               |
| 2    | Answerable     | Tier 1 + a held or peer decision path + native decision emission      | Permission requests and questions answerable remotely |
| 3    | Conversational | Tier 2 + honest `inject` returning `Delivered` or a nameable `Queued` | Follow-up instructions from web and mobile            |

Two rules keep the tiers meaningful:

- **A capability is proven by fixture, not by inspection.** Every declared
  capability has a recorded native payload and a recorded native decision the
  adapter emits for it. Four connectors currently declare `permissionHook` in
  their conformance manifests and none of them functions; one declares it with
  no script present at all. That is the failure mode this rule exists to stop.
- **A negative test is mandatory.** An unbound session in an unrelated directory
  must be demonstrably untouched and unblocked by every registered integration.

---

## 11. Integration shape requirements

### 11.1 Shape A — callback scripts are thin pipes

All resolution, state, and formatting lives in the CLI so every connector shares
one implementation:

```bash
#!/bin/bash
BODY=$(cat -)
command -v ovld >/dev/null 2>&1 || exit 0
printf '%s' "$BODY" | ovld protocol <subcommand> --payload-file -
exit 0
```

A hundred lines of inline Python doing state management inside a shell script is
the counter-example, and one exists in the tree today.

For a held decision the script must **not** background the call. A script ending
in `) & disown` with stdout to `/dev/null` is structurally incapable of returning
a decision regardless of what the CLI does — and three shipped scripts are
written exactly that way.

### 11.2 Shape B — extensions are thin bindings

Extension code runs inside the agent process, with the agent's memory,
credentials, and event loop. It therefore does the least possible: translate,
call the CLI, return. It must not import Overlord backend clients, must not hold
tokens, and must catch everything — an exception inside the harness's event loop
is a crash in someone's editor.

### 11.3 Shape C — control-plane clients are supervised sidecars

The adapter is a process Overlord starts alongside the harness, holding a
subscription to the harness's event stream. It must bind to loopback only, must
carry whatever authentication the harness supports, must reconnect with backoff
and re-read state on reconnect rather than assuming it missed nothing, and must
exit when the harness exits. It is the only shape where Overlord can lose events
by being disconnected, so gap recovery is a requirement rather than a nicety.

---

## 12. Adding a connector

1. Determine the integration shape (§2) and the capability tier target (§10).
2. State where the native session id comes from, and whether a subprocess the
   agent runs can read it (§3.2). A connector with no answer gets Tier 1.
3. Write the translation layer per §11 for its shape; put all logic in a CLI
   subcommand shared across connectors.
4. Confirm the gate runs before any I/O (§4).
5. For held decisions, set a wait strictly below the harness ceiling and confirm
   every failure path returns no decision (§7).
6. Record native fixtures for every payload observed and every decision emitted.
7. Add the negative test: an unbound session in an unrelated directory is
   untouched and unblocked.
8. Extend `ovld doctor` to report presence, scope, and binding.
9. Declare only capabilities backed by fixtures, and file the harness's row in
   [connector-harness-taxonomy.md](./connector-harness-taxonomy.md).

---

## 13. Contract impact

The current vocabulary in `contract/extension-points.yaml` encodes the
hook-shaped assumption this document retires. `approvedConnectorCapabilities`
names capabilities after Claude hook types (`followUpHook`, `permissionHook`,
`stopHook`, `editHook`), and `approvedHookTypes` is a closed set of four Claude
event names. Neither can describe a connector that answers permissions through
an HTTP endpoint or injects a message through an in-process call.

Proposed, for a contract version bump from `44`:

- **Capabilities named for what they do, not for where they came from.**
  `sessionEventStream`, `answerableRequests`, `remoteDecisionHold`,
  `messageInjection`, `nativeSessionBinding`. Keep the existing four hook-named
  flags as deprecated aliases for one release so no manifest breaks.
- **A declared `integrationShape` of `callback | extension | controlPlane`**, so
  the core can gate window policy without inspecting the agent identifier.
- **`hookTypes` becomes advisory and harness-scoped**, replaced for capability
  purposes by the normalized event vocabulary. A closed set of four Claude event
  names cannot describe Codex's fourteen, Cursor's twenty-one, Pi's
  thirty-plus, or OpenCode's event bus.
- **A `capabilityTier` field**, derived and validated rather than hand-declared,
  so conformance can fail a connector that claims more than its fixtures prove.

Impact on other modules: `cli` (`setup-doctor`, connector install and
verification), `connectors/*` (manifests), `backend` (capability projection into
the Exchange), `webapp` and mobile (control rendering keyed on tier rather than
on agent identifier), and `database` only if tier is persisted rather than
derived.

---

## 14. Module impact

| Module                  | Change                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `connectors/adapters/*` | Per-harness translation only; repair the four broken scripts; add shape-appropriate status surfaces |
| `cli`                   | Session-id binding at attach; scope gate; held-decision subcommand; `ovld requests`; doctor checks  |
| `packages/core`         | Binding storage keyed by native session id; formatter registry; capability grading                  |
| `contract`              | §13                                                                                                 |

No standalone contract change is proposed here; the surfaces above are the ones
[agent-interaction-acp.md](./agent-interaction-acp.md) already schedules for
Phase 0, and this document defines the harness-agnostic rules those phases
implement.
