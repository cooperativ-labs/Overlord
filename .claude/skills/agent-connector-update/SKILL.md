---
name: agent-connector-update
description: Use when changing how Overlord integrates with any agent connector (Claude Code, Codex, Cursor, Gemini CLI, OpenCode) — adding/removing protocol operations, changing launch commands, modifying bundle/plugin install behavior, updating slash commands, or altering permission/hook wiring. Enforces parity across all agents, the four protocol surfaces (API/CLI/MCP/plugin docs), and keeps the connector surfaces and drift-review documentation in sync.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
user-invocable: true
---

# Agent Connector Update

<agent-connector-update>

Connector code lives in many parallel places. A change to one agent or one surface that doesn't propagate to the others is the most common source of bugs in this repo. Use this skill any time you touch connector wiring so that every agent and every surface stays aligned.

## Source of truth

Before making changes, read these two documents — they describe the current parity expectations and how to audit them:

- [ai/guidence/CONNECTOR_SURFACES.md](/Users/jake/Development/Cooperativ/Overlord/ai/guidence/CONNECTOR_SURFACES.md) — per-agent surface inventory and the protocol parity matrix
- [.claude/skills/drift-review/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/.claude/skills/drift-review/SKILL.md) — how drift across surfaces is identified

Treat `CONNECTOR_SURFACES.md` as a checklist. If your change adds, removes, or modifies anything listed there, that section must be updated in the same change.

## Scope check — what triggers this skill

Apply this skill if the change touches any of:

- A protocol operation (new/removed/renamed verb, parameter change, response shape change)
- An agent launch command, model flag, or thinking/effort flag
- An agent bundle/plugin installer or its managed files (skills, hooks, slash commands, settings/permission rules)
- Slash command content for any agent
- Onboarding copy that names a connector or `ovld setup` command
- The capability resolver or context route's per-agent branching
- The prompt builder's per-agent workflow text

If none of those apply, you don't need this skill.

## Two axes of parity

Every connector change must be evaluated along **both** axes. Walk them in order.

### Axis 1 — Apply across all agent plugins and bundles

The five agents are: **Claude Code, Codex, Cursor, Gemini CLI, OpenCode**. Bundle-backed: `claude`, `cursor`, `opencode`. Legacy-prompt-only: `codex`, `gemini`.

For any connector behavior change, ask: *does each agent need the equivalent change?* Some changes are agent-specific (e.g., a Claude permission hook does not apply to Gemini), but the decision must be deliberate and reflected in the surfaces doc.

For each affected agent, verify and update as needed:

1. **Bundle / plugin installer** — `electron/services/agent-bundle/installer.ts`, `electron/services/overlord-plugin.ts`, and templates in `electron/services/agent-bundle/templates.ts` (`CLAUDE_SKILL_CONTENT`, `OPENCODE_AGENTS_SECTION`, etc.)
2. **Slash commands** — `electron/services/agent-bundle/slash-commands.ts`. Note format differences: Claude/Cursor/OpenCode are Markdown with `$ARGUMENTS`; Gemini is TOML with `{{args}}`; OpenCode requires `agent: build` frontmatter.
3. **Plugin skills** — the `overlord-ticket` SKILL.md in `plugins/claude/skills/`, `plugins/cursor/skills/`, and `plugins/overlord/skills/` (the Codex plugin). Keep workflow instructions consistent.
4. **Local Codex MCP shim** — `plugins/overlord/scripts/overlord-mcp.mjs` (this is how Codex reaches the protocol locally).
5. **Launch service** — `electron/services/agent-launcher.ts`. Verify model flag, thinking/effort flag, and prompt-passing convention for each agent (see the per-agent command patterns in `CONNECTOR_SURFACES.md`).
6. **Capability resolver** — `lib/overlord/agent-capabilities.ts`. If bundle eligibility, instruction mode, or a new capability flag changes, update this.
7. **Context route + prompt builder** — `app/api/protocol/context/[ticketId]/route.ts` and `lib/overlord/ticket-prompt.ts`. The `agent=` param branches are the per-agent prompt customization point.
8. **Onboarding & settings UI** — `components/features/onboarding/steps/AgentSetupStep.tsx`, `ConnectorSetupStep.tsx`, `InstallAgentBundlesStep.tsx`, `ConfigureAgentPermissionsStep.tsx`, plus `components/modals/settings/AgentsAndMcpPage.tsx` and `CliPage.tsx`. Connector feature lists and `ovld setup <agent>` references live here.
9. **IPC** (Electron) — `electron/ipc/app.ts`, `electron/preload.ts`, `types/electron.d.ts`. New installer/repair/uninstall actions need IPC plumbing.
10. **Demo copy** — `app/demo/DemoSettings.tsx` should describe the same managed files the real installer writes.

### Axis 2 — Keep the four protocol surfaces aligned

Any new or changed protocol operation must be exposed (or deliberately not exposed, with a `// UI-private` marker) across **all four** surfaces. See the parity matrix in `CONNECTOR_SURFACES.md` for the canonical list.

| Surface | File | Convention |
|---|---|---|
| API route | `app/api/protocol/<op>/route.ts` (or `apps/web/app/api/protocol/...`) | REST, kebab-case path, body keys `snake_case` |
| CLI subcommand | `packages/overlord-cli/bin/_cli/protocol.mjs` | `ovld protocol <op>`, `--kebab-case` flags |
| MCP tool | `supabase/functions/mcp/tools.ts` and `plugins/overlord/scripts/overlord-mcp.mjs` | `snake_case` tool name and parameters; CLI artifact tools keep `<verb>_<noun>` shape |
| Plugin skill docs | `plugins/{claude,cursor,overlord}/skills/overlord-ticket/SKILL.md` | Documents which CLI/MCP commands the agent should use |

For any new operation:

- Confirm it ships an API route — **the API is the contract**. CLI and MCP must call into it (directly or through shared helpers); they must not implement protocol logic independently.
- Confirm CLI and MCP parameter sets are the same set of fields the API accepts, just with the per-surface naming convention. Naming reference is in `CONNECTOR_SURFACES.md` ("Naming Convention Reference" in `drift-review`).
- Confirm `agentIdentifier` and `connectionMethod` defaulting still works (CLI defaults to `<agent>`/`cli`; MCP defaults to `mcp`).
- If the operation is intentionally surface-restricted (e.g., UI-only `GET /context/[ticketId]`), mark the route with `// UI-private — not exposed via CLI/MCP by design` so future drift audits don't flag it.

## CLI command + help text checklist

When an operation, flag, or setup target changes:

- Update the dispatcher block and handler in `packages/overlord-cli/bin/_cli/protocol.mjs` (or `setup.mjs` for `ovld setup` targets).
- Update help text printed by `--help` / `ovld protocol help` and any per-subcommand help.
- If the change affects `ovld setup all`, `ovld doctor`, or any aggregate command, update those too.
- If you renamed a flag, keep the old name as an alias for one release where feasible, and call it out in the deliver summary.

## Documentation updates (always required)

After making code changes, update the docs in the **same** change:

### `ai/guidence/CONNECTOR_SURFACES.md`

- For each affected agent section (1–6 subsections), update file references, command patterns, managed file lists, and checklists so they match the code you just wrote.
- If you added/removed/renamed a protocol operation, update the **Protocol surfaces (parity matrix)** table and the **Source-of-truth files** list.
- If you added a new agent or removed one, update the agent table at the top, the bundle support list, the regression checks at the bottom, and the capability resolver reference.
- Keep file paths absolute (`/Users/jake/Development/Cooperativ/Overlord/...`) — that's the existing convention in this doc.

### User-facing docs (`docs/` and `apps/web/docs/`)

Connector behavior is also described in user-facing documentation. Any change that alters how a user sets up, authenticates, or launches an agent must be reflected there:

- `docs/MCP_AUTH_AND_INTEGRATION.md` — auth + cloud/headless integration reference (called out from `CONNECTOR_SURFACES.md`)
- `docs/overlord-new-user-guide.md` — onboarding walkthrough; update if `ovld setup <agent>` flow or onboarding steps change
- `apps/web/docs/` — if/when web-app-served documentation lives here, update any connector or protocol pages alongside the code change. Grep this directory for the affected agent name, `ovld setup`, the protocol op name, or the MCP tool name and update every match.

If a code change adds a new managed file, a new `ovld setup` target, a new protocol op, or a new launch flag, search both `docs/` and `apps/web/docs/` for stale references before delivering.

### `.claude/skills/drift-review/SKILL.md`

- If a new protocol surface or a new agent plugin path was introduced, update the **Product Surfaces** table and the surface-extraction steps in Phase 1.
- If a new naming convention is in play, update the **Naming Convention Reference** table.
- If a new category of drift becomes possible (e.g., a new capability flag that must match across surfaces), add it under Phase 3.

## Workflow

1. Read `CONNECTOR_SURFACES.md` end-to-end so the parity expectations are loaded.
2. Identify which agents and which of the four surfaces are touched by your change. Write the list down before editing.
3. Make the code changes, walking the Axis-1 and Axis-2 checklists for the touched agents/surfaces.
4. increment the version number of the updated plugins, bundles, commands, connectors, etc. (the bottom of each should always have a version number in the following format: `<!-- version: 1.0.0 -->`)
4. Update `CONNECTOR_SURFACES.md` and `.claude/skills/drift-review/SKILL.md` to reflect the new reality.
5. As a final pass, invoke the `drift-review` skill (or mentally walk its Phase 3 checks) to confirm no surface was missed.
6. In your deliver summary, list which agents and surfaces were touched, and call out any deliberate asymmetries (e.g., "Gemini intentionally not updated because it has no permission hook").

## Common pitfalls

- Adding an MCP tool but forgetting the corresponding CLI subcommand (or vice versa).
- Adding a new flag to the API but not threading it through `protocol.mjs` `parseFlags()` or the MCP `inputSchema`.
- Adding a new bundle-managed file but not updating the manifest entry in `~/.ovld/bundle-manifest.json` (or its plugin equivalent).
- Updating slash command content for Claude/Cursor/OpenCode but forgetting Gemini's TOML format with `{{args}}`.
- Updating the launcher's model flag for Claude (`--model`) but forgetting that Codex uses `-c model_reasoning_effort=` and Gemini uses `--thinking-level`.
- Updating `electron/services/agent-launcher.ts` without updating the matching command pattern documented in `CONNECTOR_SURFACES.md`.
- Forgetting to remove legacy bundle entries when an agent moves between bundle modes (see Codex bundle migration cleanup).

</agent-connector-update>

<!-- version: 1.0.0 -->
