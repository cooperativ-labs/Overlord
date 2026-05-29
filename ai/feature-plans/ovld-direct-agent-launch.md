# Direct Agent Launch — `ovld <agent> "<prompt>" [flags]`

Ticket 1:1246. Let users launch the agent of their choice directly from the CLI —
`ovld claude "fix the flaky login test" --model opus` — and have Overlord
**auto-create a ticket from the prompt** (project inferred from the working
directory), then run the normal ticket lifecycle (attach → execute → deliver).
The point: power users get all of Overlord's tracking without ever opening the
desktop/web UI. Launch is limited to agents that have an installed connector
(built-ins) or a user-defined custom agent. Builds on
[user-agent-model-selection.md](./user-agent-model-selection.md).

## TL;DR — most of the backend already exists

This is **primarily a CLI ergonomics feature**, not a new backend.

- `/api/protocol/prompt` → `runSpawnProtocol` (`lib/overlord/protocol-spawn.ts`)
  already: resolves the project from `workingDirectory` via
  `resolveProjectByWorkingDirectory` (falling back to the org's first project),
  derives a title from the objective (`deriveTitleFromObjective`) **and** kicks
  off async AI title generation, resolves the `delegate` (agent/model), creates
  the ticket in `execute` status, and attaches a session. It returns
  `{ session.sessionKey, ticket }`.
- `ovld prompt` (`packages/overlord-cli/.../new-ticket.mjs`) already chains
  "create ticket → set `TICKET_ID` → `runLauncherCommand('run', [agent, …])`",
  but **interactively** (numbered project + agent pickers) and only via
  `--objectives-json`.
- `runAgent` / `runCustomAgent` (`launcher.mjs`) already launch every built-in
  agent and resolved custom agents, honoring `--model`, `--thinking`, `--flag`,
  `--pre-command`, and SSH/tmux.

So the work is: **(1)** a new top-level CLI command form that dispatches a bare
agent name to a non-interactive "prompt + launch" flow, **(2)** an arg grammar
that separates the objective text, Overlord flags, and agent passthrough flags,
**(3)** gating to installed connectors + custom agents, and **(4)** docs/help.

## Current architecture (relevant pieces)

- **Top-level dispatch** — `packages/overlord-cli/bin/_cli/index.mjs::runCli`
  matches the first argv token against a fixed set of commands
  (`attach`, `create`, `prompt`, `auth`, `tickets`, `ticket`, `protocol`,
  `runner`, `setup`, `update`, `doctor`, `version`, `launch`/`connect`/`restart`/
  `run`/`resume`/`launch-custom`). Anything else → "Unknown command".
- **Canonical agent list** — `lib/helpers/agent-types.ts` `AGENT_TYPES` /
  `LaunchAgentType` = `claude | codex | cursor | antigravity | opencode | pi`.
  Note three drifting copies of "supported agents":
  - `launcher.mjs` `supportedAgents` = all six incl. `pi`.
  - `setup.mjs` `supportedAgents` = `claude, codex, cursor, antigravity,
    opencode` (no `pi`).
  - `attach.mjs` `AGENTS` = five (no `pi`).
- **Installed-plugin detection** — `setup.mjs` `readManifest()` reads
  `bundle-manifest.json`; `doctorAgent(agent)` treats `manifest[agent]` present
  + version/hash match + files present as "installed". This is the authoritative
  "has an installed plugin" signal. (Not currently exported.)
- **Custom agents** — defined per-user in `user_agent_configs` reserved
  `__custom__` row (`customAgents: CustomAgent[]`, see model-selection plan).
  `lib/helpers/custom-agent.ts` resolves `{{token}}` templates. Launched via
  `ovld launch-custom --command "<resolved>"`, which fetches generic `claude`
  context and runs `<command> <context>` with `AGENT_IDENTIFIER=custom`.
  **The CLI has no way to fetch a user's custom agent list today** — that is a
  new interface this feature needs.

## UX / command grammar

```
ovld <agent> "<prompt>" [overlord flags] [-- <agent passthrough flags>]
```

Examples:

```bash
# built-in, project inferred from cwd, model + effort go to the ticket delegate
ovld claude "refactor the auth middleware" --model opus --thinking high

# pass native agent flags through verbatim after `--`
ovld codex "investigate the memory leak" -- --search --full-auto

# explicit project + human-review ticket
ovld cursor "tidy the dashboard styles" --project-id <uuid> --for-human

# custom agent (id from the user's custom-agent list)
ovld ollama-claude "summarize today's diffs" --model qwen2.5-coder
```

### Argument resolution rules

1. **Command = agent.** `argv[0]` is the agent. Resolve in order:
   built-in `LaunchAgentType` → user's custom-agent ids. If it matches neither a
   known top-level command **nor** a launchable agent, keep today's "Unknown
   command" error. Built-in command names always win over agents (no agent is
   named `attach`, `setup`, etc., so no real collision; still, reserve the
   command names as non-agent to be safe).
2. **Objective = first non-flag positional.** If omitted, read from stdin when
   piped (`echo "do X" | ovld claude`); if still empty and TTY, fall back to the
   existing interactive `ovld attach <…> <agent>` flow (search an existing
   ticket instead of creating one). This keeps `ovld claude` with no args useful.
3. **Overlord flags** (recognized, consumed by the CLI):
   `--project-id`, `--personal`, `--for-human`, `--priority`, `--title`,
   `--acceptance-criteria`, `--available-tools`, `--working-directory`,
   `--model`, `--thinking`, `--flag` (repeatable), `--pre-command`,
   `--launch-mode`, and the remote set (`--ssh-command`,
   `--remote-working-directory`, `--server-multiplexer`, `--tmux-command`).
   `--model`/`--thinking` do double duty: they set the ticket `delegate`/model
   **and** are forwarded to the agent binary (same as `ovld launch` today).
4. **Agent passthrough = everything after `--`.** Forwarded verbatim to the
   agent binary. This is the clean way to support "whatever other flags the
   agent takes" without the CLI needing to know every agent's flag vocabulary.
   Internally these are appended to the launcher's `extraArgs` (same channel as
   repeated `--flag`).

Rationale for `--` over "unknown flags pass through": explicit, unambiguous, and
avoids an Overlord flag rename ever silently changing what reaches the agent.
Document both `--flag <x>` (single) and `-- <many>` (bulk) so users can pick.

## Design

### New CLI module: `direct-launch.mjs`

`runDirectLaunch(agent, args)`:

1. Parse args into `{ objective, overlordFlags, passthrough }` per the grammar
   above (reuse `parseLauncherArgs`, plus split on the first standalone `--`).
2. Resolve auth (`resolveAuth`).
3. **Classify the agent**:
   - Built-in (`LaunchAgentType`): require an installed connector via the new
     `isAgentConnectorInstalled(agent)` helper (see CLI changes). If not
     installed → error: `claude connector not installed. Run \`ovld setup
     claude\` first.` Bypass with `--allow-uninstalled` for power users / CI.
   - Custom: fetch the user's custom-agent list (new `/api/protocol/agents`
     endpoint), match by `id`; resolve its `commandTemplate` with
     `--model`/`--thinking`/positional values via `resolveCustomAgentCommand`.
4. **Create the ticket** by POSTing `/api/protocol/prompt` (same body
   `protocolPrompt` builds): `objectives: [{ objective }]`, `agentIdentifier`,
   `delegate`, `workingDirectory: cwd` (unless `--project-id`/`--personal`),
   `forHuman`, `priority`, `title`, `connectionMethod: 'cli'`, `metadata`.
   This auto-resolves the project from cwd and auto-titles. Capture
   `TICKET_ID` (+ `SESSION_KEY`) from the response.
   - If the server reports no project resolvable from cwd, fail with a clear
     hint: run `ovld add-cwd` here, or pass `--project-id`.
5. **Launch locally**: set `process.env.TICKET_ID`, then
   - built-in → `runLauncherCommand('run', [agent, '--ticket-id', id, …mapped
     flags…])` (model/thinking/pre-command/flags/ssh forwarded; passthrough
     appended as `--flag` entries).
   - custom → `runLauncherCommand('launch-custom', ['--command', resolved,
     '--ticket-id', id, …])`.

The existing `runPromptCommand` is effectively a refactor target: extract a
shared `createTicketAndLaunch({ agent, objective, flags, interactive })` so
`ovld prompt` (interactive) and `ovld <agent>` (non-interactive) share one code
path and one set of bugs.

### Installed-connector gating

- Promote `readManifest` + a new `isAgentConnectorInstalled(agent)` /
  `listInstalledConnectors()` from `setup.mjs` into a shared spot (export from
  `setup.mjs` or move manifest helpers into `local-config.mjs`) so both
  `doctor` and `direct-launch` use one implementation.
- Reconcile the three "supported agents" lists against `AGENT_TYPES`. Decide
  `pi`'s status (it's launchable but has no setup bundle and isn't in
  `attach`/`setup` lists) — either add a `pi` connector or document that `pi`
  can't be direct-launched until it has a bundle. Capture the decision in the
  drift-review surface.
- Custom agents have no bundle; "installed" for them = "present in the user's
  custom-agent list."

### Custom-agent fetch — new interface

The CLI currently cannot read a user's custom agents. Add a read endpoint:

- `GET /api/protocol/agents` (or `POST /api/protocol/list-agents`) →
  `{ builtins: [{ value, label, installed? }], customAgents: CustomAgent[] }`
  scoped to the authenticated user (reuse `getAllAgentConfigsByUserIdAction`
  / the `__custom__` row). `installed` for builtins is client-side only (the
  server can't see the local manifest), so the CLI overlays its own manifest
  check; the endpoint just supplies the catalog + custom definitions.
- The CLI resolves the custom template locally with `resolveCustomAgentCommand`
  (already isomorphic JS in `lib/helpers/custom-agent.ts`).

## Interfaces to update

### CLI (`packages/overlord-cli/bin/_cli/`)
- `index.mjs` — after the known-command switch, before "Unknown command":
  resolve `command` against built-in agents + fetched custom agents; if it's an
  agent, `await runDirectLaunch(command, rest)`. Update `printHelp` with the new
  primary form and examples.
- `direct-launch.mjs` (new) — the command above.
- `new-ticket.mjs` — extract the shared `createTicketAndLaunch` helper; reuse
  for `ovld prompt`.
- `launcher.mjs` — accept passthrough args (append after `extraArgs`); reconcile
  `supportedAgents` with `AGENT_TYPES`; thread `--allow-uninstalled` if launch
  gating also lives here.
- `setup.mjs` — export `readManifest` + `isAgentConnectorInstalled` /
  `listInstalledConnectors` (or relocate to a shared module).
- `protocol.mjs` — optional `ovld protocol list-agents` wrapper over the new
  endpoint for parity/testing.
- `README.md` — document the new command form.

### API routes (`apps/web/app/api/protocol/`)
- Reuse `prompt/route.ts` as-is for ticket creation (no change required).
- New `agents/route.ts` (or `list-agents`) — catalog + per-user custom agents
  for the CLI. Auth via the protocol bearer/local-secret pattern; respond with
  the user's `customAgents` and the built-in catalog.
- Optional: extend the spawn body/`launch_params` to persist the resolved
  `customCommand` for custom-agent launches (mirrors the model-selection plan's
  end-to-end `customCommand` threading) so remote/runner replays work.

### Server libs
- No change to `runSpawnProtocol` for the happy path. Confirm
  `resolveProjectByWorkingDirectory` returns a distinguishable "no match" so the
  CLI can show the `ovld add-cwd` hint rather than silently using the org's
  first project. If it always falls back, add a response flag (e.g.
  `projectResolvedBy: 'working-directory' | 'fallback'`) so the CLI can warn.

### Docs (`apps/web/app/docs/`)
- `surfaces/cli/` and `for-agents/cli-reference/` — add the `ovld <agent>`
  command, the arg grammar (objective vs Overlord flags vs `--` passthrough),
  the installed-connector requirement, and custom-agent usage.
- `quick-start/` — add a "launch an agent in one line" example.

### Help docs / connector surfaces
- `index.mjs printHelp`, `launcher.mjs printLauncherHelp` — new form + `--`
  passthrough + `--allow-uninstalled`.
- Run the **drift-review** and **agent-connector-update** skills: this touches
  the CLI, an API route, help docs, and (potentially) `pi` parity — all four
  protocol surfaces and the connector parity matrix must stay aligned.

## Edge cases & decisions

- **Agent name vs command collision** — none today, but guard: built-in command
  names take precedence; reserve them so a future custom agent can't be named
  `setup`/`protocol`/etc.
- **No project for cwd** — explicit error + `ovld add-cwd` hint; do not silently
  create in the wrong project.
- **No objective + non-TTY** — error with usage. **No objective + TTY** → fall
  back to interactive `ovld attach` (pick an existing ticket).
- **Prompt with shell metacharacters / multiline** — encourage quoting; support
  stdin piping for long prompts.
- **`--model`/`--thinking` dual use** — keep parity with `ovld launch` (sets
  delegate + forwarded to binary).
- **Custom agent gating** — "installed" = present in user's list; surface a
  clear error when the id is unknown, listing available agents.
- **`pi`** — resolve the bundle/parity gap before claiming `ovld pi` works.

## Phased implementation

1. **Phase 1 — built-in agents, explicit objective.** Dispatch in `index.mjs`,
   `direct-launch.mjs`, shared `createTicketAndLaunch`, installed-connector
   gating, `--` passthrough. (No custom agents, no new endpoint.)
2. **Phase 2 — custom agents.** New `/api/protocol/agents` endpoint, CLI fetch +
   template resolution, `launch-custom` wiring, `launch_params` persistence.
3. **Phase 3 — polish.** stdin objective, interactive fallback,
   `projectResolvedBy` warning, `pi` decision, drift-review + docs + help.

## Testing

- CLI unit tests (alongside existing `new-ticket`/launcher tests): arg-grammar
  parsing (objective vs flags vs `--` passthrough), agent classification,
  installed-connector gating, custom-template resolution.
- Integration: `ovld claude "…"` in a registered project dir creates an
  `execute` ticket with a derived title and launches; in an unregistered dir it
  errors with the `add-cwd` hint.
- Parity: drift-review across CLI/API/MCP/plugin docs; `update-docs` link check.
