# Custom Harness Connector — Proposal

**Ticket:** 1:1124
**Status:** Proposal (no code shipped)
**Author:** Claude (exploration)

## 1. Problem

Overlord ships first-class connectors for six agents: Claude Code, Codex, Cursor, Gemini, OpenCode, Pi. Each connector is enumerated at compile time across roughly fifteen surfaces (`LaunchAgentType` union, `agent-launcher.ts` switch, `agent-capabilities.ts`, bundle installer, slash-command installer, Codex plugin installer, `ovld setup`, onboarding UI, agent-type registry, model registry, launch-commands builder, demo settings, IPC, etc.). Adding a seventh requires touching all of them.

Users want to point Overlord at their own harness (a fork of Aider, an internal agent, a fresh CLI a teammate is building) without us merging a PR. The objective asks: provide a prompt the user gives to their coding agent so it can scaffold the connector, plus a way to plug that connector into Overlord.

## 2. What's already agent-agnostic

The protocol itself is the easy part — it's already a generic contract:

- `POST /api/protocol/{attach,update,ask,deliver,record-work,...}` accept any caller with a valid bearer token. Nothing in the route handlers branches on `agentIdentifier` for behavior; it's only used for telemetry.
- `ovld protocol *` subcommands are a thin shell over those routes. Any harness that can shell out to `ovld` (or `curl`) can drive a ticket end-to-end.
- DB columns that carry agent identity (`user_agent_configs.agent_type`, `agent_models.agent_type`, `user_launch_preferences.agent_type`) are plain `text`, not enums. The schema does not need to change to accept new values.
- `user_agent_configs.config` is JSONB — flags, model defaults, permissions can already be stored per agent without a migration.

So the bottleneck is **not** the protocol or the storage. The bottleneck is the **launch surface** — the code that turns "user clicked Launch on this ticket" into an actual shell command — plus the **UI surface** that lets the user pick an agent.

## 3. Where the hard-coding lives (the surfaces a custom connector has to plug into)

| Concern | File | Today |
|---|---|---|
| Agent registry | `lib/helpers/agent-types.ts` | Frozen union + `AGENT_TYPES` array |
| Launch command construction | `apps/desktop/electron/services/agent-launcher.ts` | Six-branch `if/else` on `input.agent` |
| Model/thinking flag mapping | same file, `buildModelThinkingFlags` | Switch per agent |
| Copy-to-clipboard launch command | `lib/overlord/launch-commands.ts` | Same union |
| Bundle install | `apps/desktop/electron/services/agent-bundle/{installer,templates,slash-commands}.ts` | Claude/Cursor/OpenCode only |
| Codex plugin install | `apps/desktop/electron/services/overlord-plugin.ts` | Codex only |
| Capability resolver | `lib/overlord/agent-capabilities.ts` | Whitelist of bundle-supported agents |
| `ovld setup` CLI | `packages/overlord-cli/bin/_cli/setup.mjs` | Hardcoded `supportedAgents` list |
| Onboarding screens | `components/features/onboarding/steps/*.tsx` | One card per built-in |
| Agent dropdowns | many `components/**` | `LAUNCH_AGENT_VALUES` consumers |
| Context route | `apps/web/app/api/protocol/context/[ticketId]/route.ts` | Builds prompts keyed by agent |
| Permission hook | only Claude has one | hardcoded in launcher |

Two observations matter for the design:

1. **The variance between connectors is mostly shape, not kind.** Every built-in launch is "construct argv, set env vars, write a context file, shell out to a binary." The differences are: name of the binary, how context is passed (positional arg vs `--prompt` vs `--append-system-prompt` vs `@file`), how the model flag is named, whether there's a `--thinking` analogue, whether a temp permissions file is needed.

2. **The "bundle" track is the expensive one to extend, and most users won't need it.** Bundles install durable files (`~/.claude/skills/*`, `~/.config/opencode/AGENTS.md`, `~/.codex/rules/*`) so the per-launch prompt can be slim. Without a bundle, the launcher falls back to `instructionMode: 'legacy'`, which inlines the full Overlord protocol instructions into the context markdown. **Legacy mode already works for any agent that takes a prompt string.** Custom connectors should ride on legacy mode out of the gate.

## 4. Proposed approach — Custom Connector Profiles

Treat a custom connector as **data** stored in the DB, not as code we merge. A user creates one of these profiles, and at launch time Overlord renders the profile through a generic template into a shell command.

### 4.1 Data model — one new table

```sql
create table custom_connector_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id bigint not null references organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  slug text not null,                       -- becomes agent_type, e.g. "aider-fork"
  label text not null,                      -- "Aider (Steve's fork)"
  icon_url text,
  description text,
  binary text not null,                     -- "aider", "/usr/local/bin/myagent"
  context_mode text not null,               -- 'positional' | 'append-system-prompt' | 'file-ref' | 'stdin' | 'env'
  context_template text,                    -- "--prompt {{contextRef}}" or "@{{contextFile}}", required for non-stdin modes
  argv_template text not null,              -- full template; see §4.3
  env_vars jsonb not null default '{}',     -- extra env to inject ({"FOO": "bar"})
  model_flag_template text,                 -- "--model {{model}}" (used when a model is selected)
  thinking_flag_template text,              -- "--effort {{thinking}}"
  model_options text[],                     -- dropdown values; null means free-text
  thinking_options text[],
  default_flags text[] not null default '{}',
  instruction_mode text not null default 'legacy',  -- always 'legacy' in v1
  visibility text not null default 'private',       -- 'private' | 'organization'
  trusted_at timestamptz,                   -- desktop "trust this connector" gate
  trusted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);
```

The `slug` is the value that flows through everywhere `LaunchAgentType` flows today. Existing JSONB tables (`user_agent_configs.config`) accept it as-is because the `agent_type` column is already free-form text.

### 4.2 Registry indirection

Add a thin resolver in front of `LaunchAgentType`:

```ts
// lib/helpers/agent-types.ts
export type ResolvedAgent =
  | { kind: 'builtin'; type: LaunchAgentType; profile: AgentType }
  | { kind: 'custom'; slug: string; profile: CustomConnectorProfile };

export async function resolveAgent(slug: string, ctx: AuthContext): Promise<ResolvedAgent>
```

Every consumer of `LaunchAgentType` that today does a switch keeps working for built-ins. For custom slugs, callers go through `resolveAgent()` and read the profile.

### 4.3 Launch templating

The launcher learns one new branch — "custom connector" — that builds the shell command by expanding placeholders in the profile's `argv_template`:

| Placeholder | Value at expansion time |
|---|---|
| `{{contextFile}}` | absolute path to the temp markdown |
| `{{contextRef}}` | `"$(cat <contextFile>)"` for inline injection |
| `{{ticketId}}` | human-readable ticket ID (`1:1124`) |
| `{{model}}` | resolved model identifier or empty |
| `{{thinking}}` | resolved effort/thinking level or empty |
| `{{tmpDir}}` | OS temp directory (for Gemini-style `@file` refs) |
| `{{flags}}` | user-supplied extra flags joined and shell-quoted |
| `{{cwd}}` | resolved working directory |

Example templates the user could write, mirroring our built-ins:

```text
# Claude-style
argv_template: "{{binary}} --append-system-prompt {{contextRef}} {{model_flag}} {{thinking_flag}} {{flags}} 'Begin working on this ticket.'"

# Gemini-style
argv_template: "{{binary}} --include-directories {{tmpDir}} {{model_flag}} {{flags}} @{{contextFile}}"

# Stdin-style
context_mode: 'stdin'
argv_template: "cat {{contextFile}} | {{binary}} --stdin {{model_flag}}"
```

Expansion is **string templating only**, never shell-interpolation of user data — the user's profile string is treated as the template and we substitute fully shell-quoted values into named slots. `{{flags}}` is the only place free-form user-supplied tokens are joined; each gets `shellQuote()` first.

### 4.4 Auth & env

Every launch already sets `OVERLORD_URL`, `OVERLORD_ACCESS_TOKEN`, `OVERLORD_ORGANIZATION_ID`, `TICKET_ID`, `AGENT_IDENTIFIER`. The custom-connector launch sets the same env plus whatever the profile's `env_vars` add. The harness then drives the ticket via `ovld protocol attach …` like every other connector — that's the whole point: protocol is universal, only the launch is custom.

### 4.5 Trust gate

Launch commands are arbitrary shell. Two mitigations:

1. **Per-device trust prompt.** On first launch of a custom connector on a given device, Desktop shows a dialog with the full expanded command (post-templating, pre-shellQuote redaction of secrets) and requires explicit "Trust" confirmation. The acceptance is persisted as `trusted_at` per device fingerprint, not per profile (a malicious edit re-prompts).
2. **Org visibility off by default.** A profile is `private` until the owner explicitly publishes to the org, and visibility changes invalidate device trust.

This is the same model AppleScript and IDE extensions use — show the code, make the user agree.

## 5. The "Build me a connector" prompt

We ship a prompt as a downloadable markdown that the user pastes into their preferred coding agent. The prompt directs the agent to:

1. Read this repository's CONNECTOR_SURFACES.md to learn the contract.
2. Inspect the user's target harness (its CLI flags, how it accepts prompts, whether it has a plugin/extension system).
3. Produce a **Connector Manifest** JSON matching the schema in §4.1, plus a short README explaining quirks.

The agent never modifies the user's Overlord install; it just emits a JSON file. The user pastes the JSON into Overlord's "Add Custom Connector" modal. That modal validates the schema, performs a dry-run template expansion, and creates the row.

Sketch of the prompt (final copy lives in `apps/web/public/connectors/build-prompt.md`):

> You are helping a user wire their AI coding harness into Overlord. Overlord drives any harness through a generic REST protocol (`POST /api/protocol/{attach,update,ask,deliver}`) — your job is **not** to integrate the protocol calls; the harness will do that at runtime. Your job is to describe **how to launch** the harness.
>
> Output a single JSON object matching this schema: `{ slug, label, binary, argv_template, context_mode, context_template?, model_flag_template?, thinking_flag_template?, model_options?, env_vars? }`. Substitution placeholders: `{{contextFile}}`, `{{contextRef}}`, `{{model}}`, `{{thinking}}`, `{{flags}}`, `{{tmpDir}}`.
>
> Before writing the JSON, inspect the user's harness:
> 1. Find the binary (`which <name>`).
> 2. Read its `--help` output.
> 3. Identify the flag that accepts a prompt or system message. If none exists, choose `context_mode: 'stdin'` and pipe via `cat`.
> 4. Identify a model selection flag, if any. Same for "thinking"/effort.
>
> Then write the manifest and explain each choice in 2–4 sentences.

(Full text in §10.)

## 6. UI surface

A new tab in Settings → **Connectors**:

- List of built-in connectors (read-only, reference)
- List of custom connectors with edit/duplicate/share/delete
- "**+ Add custom connector**" opens a modal with three tabs:
  1. **Generate with my coding agent** — shows the prompt with "Copy" and "Download .md"
  2. **Paste manifest** — JSON textarea with live validation and an expanded-command preview
  3. **Start from a built-in** — picks one of our six, exports it as an editable manifest. Helps users who want a near-clone (e.g. an `claude` wrapper script).

In the ticket-row agent dropdown, custom connectors appear after built-ins with a small "custom" badge. `ovld launch <slug>` picks them up because the CLI's allowed list becomes "built-ins ∪ DB-fetched org slugs".

## 7. Out of scope for v1

These are listed as **not done** so that the v1 stays small:

- **Bundle install for custom agents.** Each agent's extension format is different (Claude skills, Cursor plugins, Codex rules, OpenCode AGENTS.md). Templating a "skill installer" for an arbitrary unknown CLI is not a v1 problem. Custom connectors run in `instructionMode: 'legacy'` (full protocol instructions in the context markdown).
- **Permission hooks.** Only Claude has one, and it depends on Claude's `PermissionRequest` hook contract. No analogue for arbitrary CLIs.
- **Org marketplace.** Sharing inside one org is fine. Cross-org publishing is a future feature.
- **Auto-discovery.** No "scan PATH for known harnesses." User explicitly opts in.
- **MCP-style custom protocol.** Custom connectors talk to Overlord through the same REST/`ovld protocol` surface as built-ins — we don't invent a new transport.

## 8. Implementation slices

A focused first pass can ship in ~5 slices:

1. **Migration + RLS** for `custom_connector_profiles`. RLS: owner can CRUD; org members can read profiles where `visibility = 'organization'`.
2. **Server actions** in `lib/actions/custom-connectors.ts`: list/get/upsert/delete/share/trust. Zod v4 schema for the manifest in `lib/schemas/custom-connector.ts`.
3. **Generic launcher path** in `agent-launcher.ts`: if `input.agent` isn't in `LAUNCH_AGENT_VALUES`, fetch the profile and render via the template engine. New helper module `apps/desktop/electron/services/custom-connector-launcher.ts` keeps the existing switch readable.
4. **Web UI**: Connectors settings page + Add modal + agent-picker integration.
5. **CLI**: extend `ovld launch` and `ovld protocol prompt` to accept custom slugs by checking the DB. Add `ovld connectors {list,export,import}` for shell-based workflows.

The prompt artifact (§10) and CONNECTOR_SURFACES.md update are documentation-only and ship alongside slice 4.

## 9. Open questions

- **Should custom connectors honor the user's per-agent flags UI?** Yes — the existing `user_agent_configs.config.flags` array works as-is; we just have to render the editor based on the profile's `default_flags`/free-form mode.
- **Where do per-profile credentials go?** If a custom harness needs its own API key, the user's already-running shell has that. We do **not** want Overlord storing third-party credentials. The profile can name env vars it expects to inherit from the user's shell.
- **What about copy-prompt-to-clipboard for custom agents?** Easy: the same template + `instructionMode: 'legacy'` produces a self-contained prompt with the protocol instructions inlined. Add a "Copy prompt for…" entry for each visible custom connector.
- **Versioning.** A profile change shouldn't silently retroactively trust on devices that approved the prior version. Compute a `manifest_hash` and key the device trust on `(profile_id, manifest_hash)`.

## 10. Draft of the "Build me a connector" prompt

Saved separately to `apps/web/public/connectors/build-prompt.md` when slice 4 lands. Outline:

1. **What Overlord is** (one paragraph)
2. **What you are building** (one paragraph — a manifest, not an integration)
3. **The manifest schema** (table)
4. **Placeholder reference** (table)
5. **Procedure**
   1. Locate the harness binary
   2. Read `--help`
   3. Pick `context_mode`
   4. Identify model & effort flags
   5. Choose `env_vars` (e.g. API keys the harness reads at startup)
   6. Compose `argv_template`
   7. Validate by hand: substitute placeholders with example values, print the command, confirm it would launch the harness against a prompt file
6. **Output format**: single JSON object plus a short README. No code edits to the Overlord repo.

## 11. Summary

Custom harness support is a **launch-layer problem**, not a protocol problem. The protocol is already generic. We unblock it by:

1. Storing connector definitions as DB rows (one migration, one zod schema).
2. Replacing the launcher's six-way switch with a template engine for custom slugs (built-ins keep their bespoke paths).
3. Shipping a prompt that turns the user's own coding agent into the manifest author.
4. Adding a Settings UI and CLI flow to import/manage manifests.

This keeps the built-ins exactly as good as they are today (bundle, permission hook, slash commands), while letting any user wire up any CLI in an afternoon — without us merging a PR.
