# Connector Surfaces

This document is the parity checklist for every place Overlord integrates with each AI coding agent.

Use it before shipping any connector-related change. If one surface changes, check the others.

## Agents and connector models

| Agent | Local connector | Cloud/headless connector |
|-------|-----------------|--------------------------|
| Claude Code | Overlord bundle (skill + permission hook) via `ovld setup claude` | `/api/mcp` with shared OAuth credentials or explicit `OVERLORD_ACCESS_TOKEN` + `OVERLORD_ORGANIZATION_ID` override |
| Codex | Home-local chat plugin via Desktop app Settings → CLI | `/api/mcp` with shared OAuth credentials or explicit `OVERLORD_ACCESS_TOKEN` + `OVERLORD_ORGANIZATION_ID` override (`~/.codex/config.toml`) |
| Cursor | Local Cursor plugin via `ovld setup cursor` | — |
| Gemini CLI | TOML slash commands via `ovld setup gemini` | — |
| OpenCode | Overlord bundle (AGENTS.md + config) via `ovld setup opencode` | — |

## Bundle support

Bundle-backed agents get a slim ticket prompt; unbundled agents always receive the full workflow instructions on every launch.

- **Bundle supported:** `claude`, `cursor`, `opencode`
- **Legacy mode only:** `codex`, `gemini`

Capability resolver:
[agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

---

## Claude Code connector surfaces

### 1. Bundle installer

- Bundle installer:
  [installer.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/installer.ts)
- Templates (skill + hook content):
  [templates.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/templates.ts) — `CLAUDE_SKILL_CONTENT`, `PERMISSION_HOOK_SCRIPT`
- CLI install:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs) — `ovld setup claude`

Managed files:
- `~/.claude/skills/overlord-local/SKILL.md` — durable workflow skill
- `~/.claude/overlord-permission-hook.sh` — permission notification hook (mode 0755)
- `~/.claude/settings.json` — hook merged into `hooks.PermissionRequest`; `Bash(ovld protocol:*)` and `Bash(curl -sS -X POST:*)` added to `permissions.allow`

Checklist:
- Skill file is the canonical workflow instructions for bundle mode
- Hook script calls `$OVERLORD_URL/api/protocol/permission-request` when Claude awaits tool permission
- Settings merge preserves user's existing hooks and permissions (no clobber)
- Skill text tells the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Skill text tells the agent to run `ovld auth repair` itself on protocol/MCP auth failures before asking the user to log in again or proceed without Overlord updates
- Skill text tells the agent to try `ovld auth repair` before `ovld auth login --organization-id <id>` when shared credentials look stale; `--organization-id` is required in non-TTY environments with multiple organizations
- Slash command docs also tell the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Manifest entry written to `~/.ovld/bundle-manifest.json`

### 2. Slash commands

- Slash command installer:
  [slash-commands.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/slash-commands.ts)

Managed files (Markdown format):
- `~/.claude/commands/connect.md` — requires `--ticket-id`
- `~/.claude/commands/load.md` — requires `--ticket-id`
- `~/.claude/commands/attach.md` — requires `--ticket-id`
- `~/.claude/commands/create.md`
- `~/.claude/commands/prompt.md`

### 3. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)

Command pattern:
```
claude --append-system-prompt "$(cat <context-file>)" [--settings <temp-settings>] [--model <model>] [--effort <level>] <start-prompt>
```

Checklist:
- Bundle installed → `--settings` arg is omitted (durable hook already in `~/.claude/settings.json`)
- Bundle not installed → temp settings file with per-session hook is passed via `--settings`
- `instructionMode=bundle` is passed to context route when bundle is installed
- Model flag: `--model`; thinking/effort flag: `--effort`

### 4. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)
- Bundle install step:
  [InstallAgentBundlesStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/InstallAgentBundlesStep.tsx)
- Permission step:
  [ConfigureAgentPermissionsStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConfigureAgentPermissionsStep.tsx)

Checklist:
- Onboarding advertises `ovld setup claude` as the connector setup command
- Connector features list includes: skill (workflow protocol), permission hook, settings merge, slash commands, permission rules

---

## Codex connector surfaces

### 1. Local installer and migration

- Desktop-managed plugin installer:
  [overlord-plugin.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/overlord-plugin.ts)
- Settings UI for local Codex install / repair / uninstall:
  [CliPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx)
- IPC exposure:
  [app.ts](/Users/jake/Development/Cooperativ/Overlord/electron/ipc/app.ts)
  [preload.ts](/Users/jake/Development/Cooperativ/Overlord/electron/preload.ts)
  [electron.d.ts](/Users/jake/Development/Cooperativ/Overlord/types/electron.d.ts)

Managed files:
- `~/.codex/plugins/overlord/` — plugin directory (copied from app bundle)
- `~/.agents/plugins/marketplace.json` — Codex local plugin registry entry
- `~/.codex/rules/default.rules` — Overlord permission prefix rules (`ovld protocol`, `curl -sS -X POST`)
- Plugin install manifest: `~/.ovld/overlord-plugin-manifest.json`

Checklist:
- Plugin install writes `~/.agents/plugins/marketplace.json`
- Plugin install writes `~/.codex/plugins/overlord`
- Plugin bundle includes `skills/` plus install-surface assets in `assets/`
- Plugin install manages `~/.codex/rules/default.rules`
- Plugin install removes any legacy Overlord-managed Codex `AGENTS.md` section
- Plugin install removes any legacy Codex bundle manifest entry from `~/.ovld/bundle-manifest.json`
- Skill text and MCP shim tell Codex to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable

### 2. Local launch path

- Electron launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)
- Context route:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts)
- Prompt builder:
  [ticket-prompt.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- Capability resolver:
  [agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

Command pattern:
```
codex [--model <model>] [-c model_reasoning_effort="<level>"] "$(cat <context-file>)"
```

Checklist:
- Local Codex launches pass `agent=codex` into the context route
- Local Codex does not request `bundle` instruction mode (`bundleAgent = null` for Codex)
- Prompt text explicitly includes the Codex ticket workflow instructions
- Prompt text does not tell Codex to look for `overlord-local` or a local Codex bundle
- Prompt text tells Codex to run `ovld auth repair` itself on protocol auth failures before asking the user to log in again or proceed without Overlord updates
- Prompt text tells Codex to try `ovld auth repair` before `ovld auth login --organization-id <id>` when shared credentials look stale; `--organization-id` is required in non-TTY environments with multiple organizations
- Thinking/effort flag uses `-c model_reasoning_effort=<value>` (TOML inline format)

### 3. Cloud / headless Codex setup

- User-facing setup page:
  [AgentsAndMcpPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/AgentsAndMcpPage.tsx)
- Auth/integration reference:
  [MCP_AUTH_AND_INTEGRATION.md](/Users/jake/Development/Cooperativ/Overlord/docs/MCP_AUTH_AND_INTEGRATION.md)
- Public MCP endpoint:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/mcp/route.ts)

Checklist:
- Codex cloud instructions point to `~/.codex/config.toml`
- Codex cloud instructions use `/api/mcp`
- Codex cloud instructions use shared OAuth credentials where supported; manual overrides use `OVERLORD_ACCESS_TOKEN` plus `OVERLORD_ORGANIZATION_ID`
- Codex cloud guidance is clearly separated from the local plugin path

### 4. Onboarding

- Agent setup copy:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install flow:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)

Checklist:
- Onboarding tells CLI users they can run `ovld setup codex`
- Codex onboarding points CLI users to `ovld setup codex`
- Codex is not presented as a bundle-backed agent
- Codex connector features list includes: home-local plugin with bundled skill, legacy bundle migration cleanup, permission prefix rules

### 5. CLI legacy compatibility

- Setup command:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs)

Checklist:
- `ovld setup codex` installs the local Codex plugin bundle
- Help text advertises Codex as a supported setup target

### 6. Demo / product copy

- Demo settings page:
  [DemoSettings.tsx](/Users/jake/Development/Cooperativ/Overlord/app/demo/DemoSettings.tsx)

Checklist:
- Demo copy describes the Codex chat plugin, not a prompt/skills bundle
- Demo managed-file list matches the real installer outputs

---

## Cursor connector surfaces

### 1. Local plugin

- CLI install:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs) — `ovld setup cursor`
- Desktop installer:
  [installer.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/installer.ts)

Managed files:
- `~/.cursor/plugins/local/overlord/.cursor-plugin/plugin.json`
- `~/.cursor/plugins/local/overlord/rules/overlord-local.mdc`
- `~/.cursor/plugins/local/overlord/commands/connect.md` — requires `--ticket-id`
- `~/.cursor/plugins/local/overlord/commands/load.md` — requires `--ticket-id`
- `~/.cursor/plugins/local/overlord/commands/attach.md` — requires `--ticket-id`
- `~/.cursor/plugins/local/overlord/commands/create.md`
- `~/.cursor/plugins/local/overlord/commands/prompt.md`
- `~/.cursor/settings.json` permission allow rules for `ovld protocol` and `curl -sS -X POST`

### 2. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)

Command pattern:
```
agent [--model <model>] "$(cat <context-file>)"
```

Checklist:
- Bundle support via local Cursor plugin — slim workflow prompt can be used in `instructionMode=bundle`
- No permission hook
- Model flag: `--model` (no thinking/effort flag for Cursor)

### 3. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)

Checklist:
- Onboarding advertises `ovld setup cursor` as the connector setup command
- Connector features list includes: local Cursor plugin install and permission rules for ovld protocol & curl
- Skill text tells the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Slash command docs also tell the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable

---

## Gemini CLI connector surfaces

### 1. Slash commands

- Slash command installer:
  [slash-commands.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/slash-commands.ts)
- CLI install:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs) — `ovld setup gemini`

Managed files (**TOML format**, not Markdown):
- `~/.gemini/commands/connect.toml` — requires `--ticket-id`
- `~/.gemini/commands/load.toml` — requires `--ticket-id`
- `~/.gemini/commands/attach.toml` — requires `--ticket-id`
- `~/.gemini/commands/create.toml`
- `~/.gemini/commands/prompt.toml`

Note: Gemini uses `{{args}}` for argument interpolation (vs `$ARGUMENTS` for Claude/Cursor/OpenCode).

### 2. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)

Command pattern:
```
gemini [--model <model>] [--thinking-level <level>] "$(cat <context-file>)"
```

Checklist:
- No bundle support — full workflow instructions always included in the prompt (`instructionMode=legacy`)
- No permission hook
- Thinking/effort flag: `--thinking-level` (unique to Gemini)

### 3. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)

Checklist:
- Onboarding advertises `ovld setup gemini` as the connector setup command
- Connector features list includes: TOML slash commands and TOML policy rules for ovld protocol & curl

---

## OpenCode connector surfaces

### 1. Bundle installer

- Bundle installer:
  [installer.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/installer.ts)
- Templates (AGENTS.md content):
  [templates.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/templates.ts) — `OPENCODE_AGENTS_SECTION`
- CLI install:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs) — `ovld setup opencode`

Managed files:
- `~/.config/opencode/AGENTS.md` — Overlord workflow instructions merged in as a delimited section
- `~/.config/opencode/opencode.json` — `instructions` array and `permission.bash` map merged (allows `ovld protocol *`, `curl -sS -X POST *`, `curl -s -X POST *`)

Checklist:
- AGENTS.md section is wrapped in `<!-- overlord:managed:start -->` / `<!-- overlord:managed:end -->` markers
- opencode.json merge preserves user's existing instructions and bash permission entries
- Manifest entry written to `~/.ovld/bundle-manifest.json`
- No permission hook (OpenCode does not support the Claude Code hook mechanism)

### 2. Slash commands

- Slash command installer:
  [slash-commands.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/slash-commands.ts)

Managed files (Markdown with `agent: build` frontmatter):
- `~/.config/opencode/commands/connect.md` — requires `--ticket-id`
- `~/.config/opencode/commands/load.md` — requires `--ticket-id`
- `~/.config/opencode/commands/attach.md` — requires `--ticket-id`
- `~/.config/opencode/commands/create.md`
- `~/.config/opencode/commands/prompt.md`

### 3. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)

Command pattern:
```
opencode [--model <model>] --prompt "$(cat <context-file>)"
```

Checklist:
- Bundle supported — when installed, `instructionMode=bundle` is passed and slim prompt is used
- Model flag: `--model` (no thinking/effort flag for OpenCode)
- `--prompt` flag is required (unlike other agents that take the prompt as a positional argument)

### 4. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)
- Bundle install step:
  [InstallAgentBundlesStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/InstallAgentBundlesStep.tsx)

Checklist:
- Onboarding advertises `ovld setup opencode` as the connector setup command
- Connector features list includes: AGENTS.md workflow instructions, slash commands, opencode.json config merge
- Workflow instructions tell the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable

---

## Protocol surfaces (parity matrix)

The Overlord protocol is exposed across three call surfaces. Keep them aligned —
when one surface changes, check the others against this table.

| Operation | API route | CLI subcommand | MCP tool |
|---|---|---|---|
| auth-status | — | `ovld protocol auth-status` | — (CLI/human-only) |
| discover-project | `POST /api/protocol/discover-project` | `discover-project` | `discover_project` |
| attach | `POST /api/protocol/attach` | `attach` | `attach` |
| connect | `POST /api/protocol/connect` | `connect` | — |
| load-context | `POST /api/protocol/load-context` | `load-context` | — |
| search-tickets | `POST /api/protocol/search-tickets` | `search-tickets` | `search_tickets` |
| create (follow-up) | `POST /api/protocol/create-ticket` | `create` (with session flags) | `create_ticket` |
| create (standalone) | `POST /api/protocol/tickets` | `create` (no session flags) | — |
| prompt | `POST /api/protocol/prompt` | `prompt` | — |
| update | `POST /api/protocol/update` | `update` | `update` |
| record-change-rationales | `POST /api/protocol/record-change-rationales` | `record-change-rationales` | `record_change_rationales` |
| ask | `POST /api/protocol/ask` | `ask` | `ask` |
| permission-request | `POST /api/protocol/permission-request` | `permission-request` (hook-only) | — |
| read-context | `POST /api/protocol/read-context` | `read-context` | `read_context` |
| write-context | `POST /api/protocol/write-context` | `write-context` | `write_context` |
| deliver | `POST /api/protocol/deliver` | `deliver` | `deliver` |
| artifact prepare | `POST /api/protocol/artifacts/prepare-upload` | `artifact-prepare-upload` | `prepare_artifact_upload` |
| artifact finalize | `POST /api/protocol/artifacts/finalize-upload` | `artifact-finalize-upload` | `finalize_artifact_upload` |
| artifact upload (composite) | — (client-side) | `artifact-upload-file` | `upload_artifact_file` |
| artifact download URL | `POST /api/protocol/artifacts/get-download-url` | `artifact-download-url` | `get_artifact_download_url` |
| context fetch | `GET/POST /api/protocol/context/[ticketId]` | — | — (UI-private) |
| projects (list) | `GET /api/protocol/projects` | — | — (UI-private) |

Notes:
- `agentIdentifier` and `connectionMethod` are required by the API but defaulted client-side: CLI defaults to `<agent>`/`cli`, MCP defaults to `mcp`.
- `deliver` requires `artifacts` on every surface — empty array is allowed but the field must be present.
- `permission-request` is invoked by the installed permission hook/rules, not by agent logic.
- `prompt` (formerly `spawn`) creates and executes a ticket immediately. The CLI accepts `spawn` as a backward-compatible alias.
- MCP artifact tools follow `<verb>_<noun>` naming. CLI artifact subcommands keep the `artifact-*` shape for terminal ergonomics.
- `GET /context/[ticketId]` and `GET /projects` are intentionally UI-only (Overlord desktop/web). They are marked `// UI-private — not exposed via CLI/MCP by design` in code so future drift audits don't re-flag them.

Source-of-truth files:
- API routes: [apps/web/app/api/protocol/](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/api/protocol)
- CLI dispatcher: [protocol.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/protocol.mjs)
- MCP tool definitions: [tools.ts](/Users/jake/Development/Cooperativ/Overlord/supabase/functions/mcp/tools.ts)
- Local Codex MCP shim: [overlord-mcp.mjs](/Users/jake/Development/Cooperativ/Overlord/plugins/overlord/scripts/overlord-mcp.mjs)
- Plugin skill docs: [plugins/claude/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/claude/skills/overlord-ticket/SKILL.md), [plugins/cursor/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/cursor/skills/overlord-ticket/SKILL.md), [plugins/overlord/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/overlord/skills/overlord-ticket/SKILL.md)

## Shared surfaces

### Context route and prompt builder

- Context route:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts)
- Prompt builder:
  [ticket-prompt.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- Capability resolver:
  [agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

Checklist:
- Context route accepts `agent=` query param for all 5 agents: `claude`, `codex`, `cursor`, `gemini`, `opencode`
- `instructionMode=bundle` is sent for `claude`, `cursor`, and `opencode` when their bundle/plugin is installed
- `instructionMode=legacy` is used for `codex`, `gemini`, and for `claude`/`cursor`/`opencode` when bundle/plugin is not installed
- Prompt content varies per agent — verify agent-specific workflow sections when changing `ticket-prompt.ts`

### CLI setup command

- Setup command:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs)

Checklist:
- `ovld setup claude` installs bundle for Claude Code
- `ovld setup codex` installs the local Codex plugin bundle
- `ovld setup opencode` installs bundle for OpenCode
- `ovld setup cursor` installs Cursor local plugin and permission allow rules
- `ovld setup gemini` installs Gemini TOML slash commands and policy rules
- `ovld setup all` installs all supported agents (claude + codex + opencode; slash-only agents are separate)
- `ovld doctor` validates installed bundle statuses for `claude`, `codex`, `cursor`, `gemini`, and `opencode`

### Settings UI

- Agents & MCP page:
  [AgentsAndMcpPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/AgentsAndMcpPage.tsx)
- CLI settings page:
  [CliPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx)

### IPC (Electron)

- IPC exposure:
  [app.ts](/Users/jake/Development/Cooperativ/Overlord/electron/ipc/app.ts)
  [preload.ts](/Users/jake/Development/Cooperativ/Overlord/electron/preload.ts)
  [electron.d.ts](/Users/jake/Development/Cooperativ/Overlord/types/electron.d.ts)

---

## Regression checks

When changing connector integration, verify the relevant agent(s):

**Claude Code**
- Bundle status in Settings reflects skill file, hook script, and settings.json
- Installing bundle merges hook and permissions without clobbering user settings
- Launching Claude from Overlord produces the correct prompt (slim for bundle mode, full for legacy)
- Slash commands are written to `~/.claude/commands/`
- No user-facing page references `ovld setup claude` for Codex

**Codex**
- Plugin install status in Settings reflects plugin files and `default.rules`
- Installing the plugin cleans up legacy Codex bundle remnants
- Launching Codex from Overlord produces Codex-specific workflow instructions in the prompt
- Codex cloud instructions produce a valid MCP config snippet (`~/.codex/config.toml`)
- User-facing pages advertise `ovld setup codex` as the CLI install path and do not reference `~/.codex/AGENTS.md` as the local Codex path

**Cursor**
- Cursor plugin installed at `~/.cursor/plugins/local/overlord/`
- Launching Cursor from Overlord uses bundled/slim workflow prompt when plugin is installed

**Gemini CLI**
- Slash commands written to `~/.gemini/commands/` (TOML format, not Markdown)
- `{{args}}` interpolation is used in TOML content (not `$ARGUMENTS`)
- Launching Gemini from Overlord always includes full legacy workflow instructions in the prompt

**OpenCode**
- Bundle status in Settings reflects AGENTS.md section and opencode.json merge
- Launching OpenCode from Overlord produces correct prompt (slim for bundle mode, full for legacy)
- Slash commands written to `~/.config/opencode/commands/` (Markdown with `agent: build` frontmatter)
- `--prompt` flag is present in the launch command
