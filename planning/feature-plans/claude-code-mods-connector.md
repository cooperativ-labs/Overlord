# Claude Code mods for the Overlord Claude connector

Mission coo:1106 · objective coo:1106.60kg · 2026-10-03

Source: <https://claude.com/blog/claude-code-mods>, checked against the mod API declarations
shipped with Claude Code 2.1.288 (the `plugin-authoring` types, about 20,000 lines). The API is
marked early access and "moves between releases", so every proposal below is gated on a harness
version check.

## What mods are, in connector terms

A mod is a TypeScript module inside an ordinary plugin. `hooks/hooks.json` names it under
`modules`, next to the existing command hooks, so it ships in the plugin `ovld agent-setup claude`
already installs. Each hook is `($, e, next)`:

- it runs **in-process**, with no shell spawn per event;
- it **wraps** the event: code before `next(e)`, code after it, in one closure;
- `$` gives it the session (`$.session.id()`, `cwd()`), environment (`$.env.get`), host commands
  (`$.process.run`), drawing (`ui.render`, `$.ui.status`, `$.ui.toast`, `$.ui.open`) and timers.

Mods are not sandboxed and run with Claude Code's own access. On Enterprise a built-in
`sec-default` mod loads first and can stop user mods overriding permission deny rules.

What matters for Overlord is the difference from today's command hooks:

| | Command hooks (shipped) | Mod (proposed) |
| --- | --- | --- |
| Shape | one script per event, after the fact | one closure around the event |
| Tool-call identity | `session_id` only | `tool_use_id` and `agentId` (subagent) on every call |
| Read-only knowledge | none; every Bash call is "unknown" | `isReadOnly` set by the engine's own permission check |
| UI | none (`statusMessage` is static) | band above the prompt, status entry, pane, toast |
| Cost | process spawn per matching tool call | function call |

## Proposal 1: mission and objective indicator

**Feasibility: proven.** A display-only prototype is written and passes `claude plugin validate`:
`~/.claude/dev-mods/84e54b85-742e-4729-82d5-679c9f0d89d3/overlord-mission-band/`. It is not
type-checked with `tsc` and has no test yet.

One correction to the request: this build has no render site at the *top* of the terminal. The
hookable sites are `AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`,
`ToolGroup`, `ToolProgress`, `CommandOutput`, `Spinner`, `TurnDuration`, `InfoNotice`,
`SessionMode`, `PromptHint`, `AbovePrompt` and `Pane`. The always-visible equivalent is the
`AbovePrompt` band, which stays pinned directly above the input while the transcript scrolls.
A top-of-screen header would scroll away in the terminal's main screen anyway.

Prototype output:

```
◆ Overlord coo:1106 Explore Cloud Code…  ›  coo:1106.60kg Enhance Overlord Claude Connector…
```

```tsx
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  const mission = await $.env.get('OVERLORD_MISSION_ID')

  if (mission === undefined || e.props.hasSurvey) {
    return next(e) // unbound session: draw nothing, cost nothing
  }
  // … <Box><Text>◆ Overlord {mission} › {objective}</Text></Box>
})
```

Design points:

- **Binding source.** The runner already exports `OVERLORD_MISSION_ID` and
  `OVERLORD_OBJECTIVE_ID`. Titles are not exported; add `OVERLORD_MISSION_TITLE` and
  `OVERLORD_OBJECTIVE_TITLE` to the runner launch environment (additive, Runner Layer).
- **Chat-attached sessions** (Mode 2, `/overlord:attach` with no launch env) need a second source.
  `ovld protocol attach` already persists the session binding locally; add a read-only
  `ovld protocol binding --json` the mod polls with `$.process.run` on `session.start` and after
  any Bash call whose command starts `ovld protocol attach|connect|deliver`.
- **Live state, not just ids.** The same band can show phase (`executing`, `delivered`,
  `blocked`) and turn the Stop reminder into a visible `deliver pending` marker. This replaces the
  shipped Stop hook, which the descriptor records as inert (`shipped-stop-hook-inert`).
- **Unbound sessions render nothing.** This satisfies the mandatory unbound-session negative
  fixture and is strictly better than `terminal.statusSurface`'s current note that
  `statusMessage` "renders in unbound sessions too".
- **Second stage:** a `Pane` (sidebar in fullscreen) listing the mission's objectives, the
  files in this objective's ledger, and a `[ Deliver ]` button. Worth doing only after the band
  ships.

Descriptor effect: `terminal.statusSurface` moves from `not-implemented` to `supported` with a
`claude plugin test` fixture (the test kit mounts `AbovePrompt` on `terminal` and `desktop`).

## Proposal 2: file-change reporting

Today's descriptor says `mutationHooks.classification: post-only`. A named `Write`/`Edit` path is
recorded as `declared_edit`/`direct`; everything a shell command writes (generators, formatters,
`git mv`, codegen, migrations) records only "unavailable evidence health". That is the gap agents
paper over with `--paths` at delivery.

A `tool.call` mod is the paired pre/post runtime the contract's **Mutation-window foundation**
already describes ("matching session, call, workspace, tool, outcome, and path/window
semantics", recording `window_observed`/`window` with honest overlap). A validated sketch
(`claude plugin validate` passes; not run against the CLI, because `capture-window` does not
exist yet):

```ts
on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  const objective = await $.env.get('OVERLORD_OBJECTIVE_ID')
  if (objective === undefined) return next(e)          // unbound: no work at all

  const cwd = await $.session.cwd()
  const before = await dirty($, cwd)                    // git status --porcelain -z
  const overlapped = open > 0
  open += 1
  try {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isReadOnly === true) return ran
    const after = await dirty($, cwd)
    const paths = [...after].filter(p => !before.has(p)).map(p => p.slice(3))
    if (paths.length > 0) {
      await $.process.run(['ovld', 'protocol', 'capture-window', '--agent', 'claude',
        '--objective-id', objective, '--call-id', e.tool_use_id ?? '',
        '--overlap', overlapped || open > 1 ? 'concurrent' : 'exclusive',
        '--subagent', e.agentId ?? '', '--paths', paths.join(',')])
    }
    return ran
  } finally { open -= 1 }
})
```

What this buys, in order of value:

1. **Shell-written files get attributed.** The largest accuracy gain available. Evidence quality
   is `window`, weaker than `direct`, and the mod reports `exclusive` or `concurrent` honestly.
2. **Read-only shell calls go silent.** `isReadOnly` comes from the engine's own permission
   check, so `ls`, `git status` and `rg` stop producing "unavailable" health noise.
3. **Subagent attribution.** Every `tool.call` carries `agentId`. This closes the
   `fork-and-subagent-identity-unknown` hazard for file evidence without guessing from
   `session_id`, and covers subagents that outlive the parent turn (`subagent-stop-unregistered`).
4. **No spawn per edit.** `Edit`/`Write`/`NotebookEdit` capture moves in-process; the mod calls
   `ovld` only when there is a path to record.
5. **Failed edits are not recorded.** The wrapper sees `isError`, so a refused or failed write
   claims nothing.

Limits to state plainly:

- **A window is not exclusive ownership.** Another agent in the same checkout can write during
  the window. Only this session's own overlapping calls are detectable in-process; cross-process
  overlap needs the CLI to compare windows across ledgers, or stays labelled non-exclusive.
- **`git status` diffing misses a second write to an already-dirty file.** Fix by hashing
  (`git status` plus `git hash-object` on dirty paths, or mtime+size) in the CLI, not the mod.
- **Background shells** (`run_in_background`) outlive the call. The `process.spawn` stream event
  or a close-out snapshot at `turn.complete` would be needed; defer.
- **Cost:** two `git status` runs per mutating Bash call. Acceptable on this repo; needs a size
  guard (skip and record unavailable health above a time budget) for very large worktrees.
- **Privacy boundary holds** only if the mod passes paths and ids and never the command text,
  output or file contents. The sketch does; a review rule should enforce it.

Recommended split: the mod stays thin (bracket the call, hand off ids), and the snapshot/diff
logic lives in the CLI as `ovld protocol capture-window --begin` / `--end` so `.overlordignore`,
path bounding and hashing stay in one audited place. The inline `git status` above is only to
show the shape.

## Proposal 3: Remote Control

Claude Code has `claude --remote-control [name]` (interactive session also controllable from
claude.ai/code and the mobile app) and `claude remote-control` (server mode).

- **Now, no code:** add `--remote-control` to the Claude launch flags in Overlord's agent
  config. This session's launch record reads "no pre-command or flags", so it is off today.
- **Connector change:** have the runner pass the name, `--remote-control "coo:1106.60kg <title>"`,
  so the session list in claude.ai/code and on the phone is labelled by objective. This is the
  remote-surface counterpart of Proposal 1. Make it a per-agent toggle, default off: it exposes
  the session to the account's remote clients.
- **Mod hooks that become relevant:** `session.attach`/`session.detach` fire when a remote client
  joins or leaves (Overlord can show "being driven from phone"); prompt and config origins carry
  `kind: 'bridge'`, so follow-up capture can label a prompt as remote rather than typed.
- The band from Proposal 1 draws on remote surfaces too (`$.ui.resolve(e)` returns the table for
  `desktop`, `mobile`, `vscode`), so the indicator follows the session to the phone.

Not done in this objective: Remote Control was not started for this running session. It is a
launch flag or the user-typed `/remote-control` command; an agent cannot invoke either.

## Smaller opportunities

- **Repair delivery reminders.** `turn.complete` plus the band replaces the inert Stop script.
- **Permission visibility.** A `tool.check` hook sees the verdict before the prompt draws, which
  could publish "waiting on approval" to Overlord without holding the decision. Decision-holding
  stays out of scope (`decide.*` is tracked under `latch-engine`).
- **Native tools.** `$.tool.register` could expose `overlord_update` / `overlord_deliver` as
  real tools instead of Bash invocations, removing shell-quoting failures. Larger change; the
  hosted MCP server already covers most of it.

## Contract impact

Proposed changes to `CONTRACT.md`:

1. **Connector → Protocol (Hook Surface), Transport.** Currently "Shell scripts invoking
   `ovld protocol …`". Add: "or an in-process harness module that invokes the same commands".
   The no-database, no-network and privacy rules apply unchanged.
2. **Mutation-window foundation.** No rule change; Claude becomes the first adapter to qualify.
   `mutationHooks.classification` moves from `post-only` to the paired value once fixtures pass.
3. **Runner launch environment.** Additive `OVERLORD_MISSION_TITLE`, `OVERLORD_OBJECTIVE_TITLE`.
4. **Protocol.** Additive local-only commands `capture-window` and `binding`.

Impact by module:

| Module | Impact |
| --- | --- |
| Connector (claude) | New `hooks/` module, `modules` entry, descriptor + fixtures, manifest digest, version bump via `connector-versions` |
| Connector (other adapters) | None. Codex/Cursor/OpenCode/Pi keep `post-only`; pi's in-process extension is the closest analogue and could follow |
| CLI / Protocol | `capture-window`, `binding`; ledger accepts `window` evidence with overlap state |
| Runner | Two title env vars; optional `--remote-control <name>` launch flag |
| Core / service | Ledger evidence kinds already defined; confirm `window_observed` is implemented, not just specified |
| REST, Database, Webapp, Desktop, Mobile | None for Proposals 1 and 3. Proposal 2 surfaces a new evidence quality the changed-files UI should label |
| `contract/harness-capabilities.schema.yaml` | `integrationShape` may need a value for callback + in-process module; check the closed vocabulary |

## Risks

- **API churn.** Early access. Pin `harness.verifiedVersion`, keep the command hooks as the
  floor, and have the mod replace them only when it loaded (a `session.start` marker the shell
  hook checks) so evidence is never double-recorded or dropped.
- **Older Claude Code.** `versionRange` is `>=2.1.0`. Whether a pre-mods build ignores or
  rejects a `modules` key in `hooks.json` is unverified. Test before shipping, or ship the mod
  as a separate `overlord-mods` plugin installed only when `claude --version` qualifies.
- **Policy.** Enterprise `sec-default` or an org policy may refuse the mod; the command-hook
  fallback covers this.
- **Trust.** The mod runs unsandboxed in every Claude session on the machine, bound or not.
  The first statement of every hook must be the binding check.

## Suggested order

1. Mission band (ids from env, then titles). Small, visible, no contract-rule change.
2. `--remote-control` named launch flag as a per-agent toggle.
3. `capture-window` in the CLI with fixtures, then the `tool.call` mod behind a version gate.
4. Delivery state in the band; retire the Stop script.
