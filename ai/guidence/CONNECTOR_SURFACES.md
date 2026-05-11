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

Desktop local launches set `OVERLORD_SNAPSHOT_JSON` **only** when the user has enabled in-folder JJ version control (`project_user.local_version_control = jj`); the app then points snapshot metadata at the real working directory (after `GET /api/protocol/context/...`). There is no automatic managed/shadow jj workspace for projects that leave version control off. The context API does not run `jj` on the server. The CLI `deliver` command creates a local checkpoint before the `/api/protocol/deliver` request for JJ/Git workspaces.

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
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts)

Command pattern:
```
claude --append-system-prompt "$(cat <context-file>)" [--settings <temp-settings>] [--model <model>] [--effort <level>] <start-prompt>

ovld launch claude --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--thinking <level>] [--flag <value> ...]
```

Checklist:
- Bundle installed → `--settings` arg is omitted (durable hook already in `~/.claude/settings.json`)
- Bundle not installed → temp settings file with per-session hook is passed via `--settings`
- `instructionMode=bundle` is passed to context route when bundle is installed
- Model flag: `--model`; thinking/effort flag: `--effort`
- Desktop local launches intentionally do **not** shell out to `ovld launch`; they prefetch context, write temp hook/settings files, and avoid shell-quoting edge cases before spawning Claude directly

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
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts)
- Context route:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/api/protocol/context/[ticketId]/route.ts)
- Prompt builder:
  [ticket-prompt.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- Capability resolver:
  [agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

Command pattern:
```
codex [--model <model>] [-c model_reasoning_effort="<level>"] "$(cat <context-file>)"

ovld launch codex --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--thinking <level>] [--flag <value> ...]
```

Checklist:
- Local Codex launches pass `agent=codex` into the context route
- Local Codex does not request `bundle` instruction mode (`bundleAgent = null` for Codex)
- Prompt text explicitly includes the Codex ticket workflow instructions
- Prompt text does not tell Codex to look for `overlord-local` or a local Codex bundle
- Prompt text tells Codex to run `ovld auth repair` itself on protocol auth failures before asking the user to log in again or proceed without Overlord updates
- Prompt text tells Codex to try `ovld auth repair` before `ovld auth login --organization-id <id>` when shared credentials look stale; `--organization-id` is required in non-TTY environments with multiple organizations
- Thinking/effort flag uses `-c model_reasoning_effort=<value>` (TOML inline format)
- Desktop local launches intentionally stay on the direct Electron path instead of delegating to `ovld launch`; `ovld launch` is the copy/paste surface and remote shell entrypoint

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

### 5. CLI launch + compatibility

- CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- CLI help/index:
  [index.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/index.mjs)

Checklist:
- `ovld launch codex` is the documented primary launch command
- `ovld connect codex` remains a compatibility alias for one-command launches
- `ovld launch` infers organization scope from human-readable ticket ids like `1:899`; `--organization-id` remains a legacy compatibility flag for UUID ticket ids. It also supports Desktop-parity shell flags: `--working-directory`, `--launch-mode`, `--model`, `--thinking`, repeated `--flag`, `--ssh-command`, `--remote-working-directory`, `--server-multiplexer`, and `--tmux-command`

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
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)

Command pattern:
```
agent [--model <model>] "$(cat <context-file>)"

ovld launch cursor --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--flag <value> ...]
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
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)

Command pattern:
```
gemini [--model <model>] [--thinking-level <level>] "$(cat <context-file>)"

ovld launch gemini --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--thinking <level>] [--flag <value> ...]
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
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)

Command pattern:
```
opencode [--model <model>] --prompt "$(cat <context-file>)"

ovld launch opencode --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--flag <value> ...]
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
| attachment prepare | `POST /api/protocol/attachments/prepare-upload` | `attachment-prepare-upload` | `prepare_attachment_upload` |
| attachment finalize | `POST /api/protocol/attachments/finalize-upload` | `attachment-finalize-upload` | `finalize_attachment_upload` |
| attachment upload (composite) | — (client-side) | `attachment-upload-file` | `upload_attachment_file` |
| attachment download URL | `POST /api/protocol/attachments/get-download-url` | `attachment-download-url` | `get_attachment_download_url` |
| context fetch | `GET/POST /api/protocol/context/[ticketId]` | — | — (UI-private) |
| projects (list) | `GET /api/protocol/projects` | — | — (UI-private) |

Notes:
- `agentIdentifier` and `connectionMethod` are required by the API but defaulted client-side: CLI defaults to `<agent>`/`cli`, MCP defaults to `mcp`.
- Organization scope for ticket-scoped protocol calls is resolved in this order: organization id embedded in human-readable `ticket_id` (for example `1:899`), then explicit `--organization-id` / `x-organization-id`, then stored OAuth organization.
- `deliver` accepts optional `snapshot` and `checkpoint` metadata. CLI delivery also supports local-only `--checkpoint-backend <auto|jj|git>` and `--skip-checkpoint` flags; the MCP local shim exposes matching `checkpoint_backend` and `skip_checkpoint` parameters when it routes through the CLI.
- `permission-request` is invoked by the installed permission hook/rules, not by agent logic.
- `prompt` (formerly `spawn`) creates and executes a ticket immediately. The CLI accepts `spawn` as a backward-compatible alias.
- MCP objective attachment tools follow `<verb>_<noun>` naming. CLI subcommands keep the `attachment-*` shape for terminal ergonomics. (`artifacts` is reserved for the structured records agents submit via `deliver`, not user-uploaded files.)
- `GET /context/[ticketId]` and `GET /projects` are intentionally UI-only (Overlord desktop/web). They are marked `// UI-private — not exposed via CLI/MCP by design` in code so future drift audits don't re-flag them.

Source-of-truth files:
- API routes: [apps/web/app/api/protocol/](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/api/protocol)
- CLI dispatcher: [protocol.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/protocol.mjs)
- Human CLI launcher: [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder: [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts)
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
- Ticket copy surfaces:
  [CliQuickstart.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/CliQuickstart.tsx)
  [TicketPanelHeader.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/TicketPanelHeader.tsx)
  [TicketDetailScreen.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/mobile/app/(tabs)/tickets/[ticketId]/components/TicketDetailScreen.tsx)

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
- Copyable ticket commands use `ovld launch ... --ticket-id <ticket_id>` and include assigned model/thinking defaults when Codex is selected
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

---

## Migration checklist: replace `id` (UUID) with `ticket_id` (human-readable) as the ticket identifier

**Goal:** All CLI commands, MCP calls, and agent prompts should use the human-readable `ticket_id` (format: `<org_id>:<sequence>`, e.g. `1:899`) instead of the raw UUID when identifying tickets. The UUID remains the internal primary key; `ticket_id` becomes the public-facing identifier.

**Background:** The `tickets` table has both `id` (UUID, internal PK) and `ticket_id` (text, human-readable, added in migration `20260505130000`). Today every surface passes the UUID. After this migration, every surface passes `ticket_id`.

### Layer 1 — Validation schema

File: `lib/overlord/validation.ts`

- [ ] Extend `ticketIdSchema` (line 10) to accept the `ticket_id` format in addition to UUID.
  - Add: `/^\d+:\d+$/` to accept `<org_id>:<sequence>` strings like `1:899`.
  - Update the `.refine()` error message to: `'Must be a UUID or ticket_id (e.g. 1:899)'`.
- [ ] Verify the updated schema is used by all exported schemas that contain `ticketId: ticketIdSchema`: `attachSchema`, `askSchema`, `updateSchema`, `readContextSchema`, `writeContextSchema`, `deliverSchema`, `recordChangeRationalesSchema`, `createFollowUpTicketSchema`, `connectSchema`, `loadContextSchema`, `attachmentPrepareUploadSchema`, `attachmentFinalizeUploadSchema`, `attachmentListSchema`, `attachmentGetDownloadUrlSchema` (lines 38–247).

### Layer 2 — Database resolution function

File: `lib/overlord/protocol-db.ts`

- [ ] Extend `resolveTicketId()` (line 12) to handle the `ticket_id` format.
  - Add a regex constant (e.g. `TICKET_ID_REGEX = /^\d+:\d+$/`) alongside the existing `UUID_REGEX`.
  - When the input matches `TICKET_ID_REGEX`, query `tickets` WHERE `ticket_id = input` AND `organization_id = organizationId`, return the resolved `id` (UUID).
  - Preserve the existing UUID passthrough branch.
  - Return `null` for ambiguous/not-found results as before.
- [ ] Update the JSDoc comment on `resolveTicketId()` to document all three accepted formats.

### Layer 3 — Context route: pass `ticket_id` to the prompt builder

File: `apps/web/app/api/protocol/context/[ticketId]/route.ts`

- [ ] At line 156–168, the `ticket` object passed to `buildTicketPromptMarkdown` uses `id: ticket.id`.
  - Change `id: ticket.id` to `id: ticket.ticket_id ?? ticket.id` so the prompt builder receives the human-readable identifier when available, falling back to UUID when `ticket_id` is empty or null.
- [ ] Same change applies to the POST handler in the same file (if it also calls `buildTicketPromptMarkdown`).
- [ ] Confirm the fallback to UUID does not break tickets that pre-date the `ticket_id` column being populated.

### Layer 4 — Ticket prompt builder

File: `lib/overlord/ticket-prompt.ts`

- [ ] The `ticketId` parameter flows through `buildGeneralAgentInstructions()` and all per-agent prompt functions. No code changes are needed here if Layer 3 passes the correct value — but verify:
  - All `--ticket-id ${ticketId}` strings in the prompt will automatically show the human-readable ID once Layer 3 is done.
  - The line `- **Ticket ID:** ${ticketId}` (multiple agent sections) will show the human-readable ID.
  - The MCP config section `attach — use ticketId: \`${ticketId}\`` (line 458) will show the human-readable ID.
- [ ] Search for any hardcoded UUID-format expectations (e.g. regex checks) in `ticket-prompt.ts` and remove them.

### Layer 5 — CLI `prompt` command: output `ticket_id` not UUID

File: `packages/overlord-cli/bin/_cli/protocol.mjs`

- [ ] In `protocolPrompt()` (line 1186), the code reads `data.ticket?.id` for the `TICKET_ID` stderr output.
  - Change to `data.ticket?.ticket_id ?? data.ticket?.id` so `TICKET_ID=1:899` is emitted instead of `TICKET_ID=<uuid>`.
- [ ] Confirm the `attach` command (`protocolAttach()`, line 493) does **not** emit `TICKET_ID` — the caller reads it from the JSON output. No change needed there, but verify the JSON response includes `ticket.ticket_id` in the attach API response so callers can extract it.
- [ ] Update the help text block (around lines 1365, 1403, 1409, 1437, 1453):
  - Change `--ticket-id <id>` → `--ticket-id <ticket_id>` in the flag description.
  - Change the example `ovld protocol attach --ticket-id <id>` → `ovld protocol attach --ticket-id <ticket_id>`.
  - Add a note: `ticket_id is the human-readable identifier (e.g. 1:899), not the UUID.`

### Layer 6 — CLI launcher: use `ticket_id` in launch commands and help text

File: `packages/overlord-cli/bin/_cli/launcher.mjs`

- [ ] At line 124, the nested command uses `process.env.TICKET_ID` directly — this will automatically show the human-readable value once the TICKET_ID env var is set correctly (by Layer 5 or by the Desktop launcher). No code change needed if the env var is already the human-readable value.
- [ ] Update launcher help text (lines 172–174):
  - `ovld launch <agent> --ticket-id <id>` → `ovld launch <agent> --ticket-id <ticket_id>`
  - `ovld connect <agent> --ticket-id <id>` → `ovld connect <agent> --ticket-id <ticket_id>`
  - `ovld restart <agent> --ticket-id <id>` → `ovld restart <agent> --ticket-id <ticket_id>`
  - `--ticket-id <id>` flag description → `--ticket-id <ticket_id>`
- [ ] Update error messages (lines 363–367) that reference `--ticket-id <ticket_id>`.

### Layer 7 — Shared launch-commands builder

File: `lib/overlord/launch-commands.ts`

- [ ] The `ticketId` parameter in `buildAgentLaunchCommand()` (line 101) and `buildResumeCommands()` (line 201) flows into `ovld launch <agent> --ticket-id <ticketId>` strings shown as copyable commands.
  - Ensure callers (Desktop Electron launcher, web copy-command surface) pass `ticket.ticket_id` instead of `ticket.id` when constructing these commands.
- [ ] Audit all callers of `buildLaunchCommands()` and `buildResumeCommands()` to confirm they source `ticketId` from `ticket.ticket_id` after this migration.

### Layer 8 — Desktop Electron agent launcher

File: `apps/desktop/electron/services/agent-launcher.ts`

- [ ] Locate where the Electron launcher fetches or holds the `ticketId` used to build commands and set environment variables.
- [ ] Change the source from `ticket.id` to `ticket.ticket_id ?? ticket.id` so the child process receives `TICKET_ID=1:899`.
- [ ] Confirm the context fetch URL (`/api/protocol/context/<ticketId>`) continues to work — it will, because Layer 2 teaches `resolveTicketId()` to accept the human-readable format.

### Layer 9 — MCP tool descriptions

File: `supabase/functions/mcp/tools.ts`

- [ ] Update the `attach` tool's `ticketId` description (line 67): `'Ticket UUID — use the TICKET_ID from your instructions.'` → `'Ticket identifier — use the TICKET_ID from your instructions (e.g. 1:899).'`
- [ ] Update all other tools whose `ticketId` description reads `'Ticket UUID.'` (lines 108, 180, 240, 264, 290, 318):
  - Change to: `'Ticket identifier (e.g. 1:899). Accepts ticket_id or UUID.'`
- [ ] Update tools where `ticketId` has no description (lines 348, 372, 393, 416, 521) — add: `'Ticket identifier (e.g. 1:899).'`
- [ ] Update the `create_ticket` tool's `ticketId` description (line 521): `'Current ticket UUID (follow-up will be linked to this).'` → `'Current ticket identifier (e.g. 1:899). Follow-up ticket will be linked to this.'`

### Layer 10 — Codex MCP shim

File: `plugins/overlord/scripts/overlord-mcp.mjs`

- [ ] The shim already uses `ticket_id` (snake_case) as the MCP parameter name, and passes it as `'ticket-id': args.ticket_id` to the CLI. No parameter rename is needed.
- [ ] Update any description strings (lines 52, 73, 92, 147, 178, 201, 224, 245, 269, 298) from generic `'Target ticket ID'` or empty to `'Ticket identifier (e.g. 1:899).'`.
- [ ] Verify the CLI call `'ticket-id': args.ticket_id` still works after Layer 5 and Layer 2 changes (it will, since Layer 2 resolves the new format).

### Layer 11 — Slash command content (installer)

File: `apps/desktop/electron/services/agent-bundle/slash-commands.ts`

- [ ] Replace all instances of `<ticketId>` in user-facing content strings with `<ticket_id>` for clarity.
- [ ] Update command examples embedded in slash command content:
  - `ovld protocol connect --ticket-id <ticketId>` → `ovld protocol connect --ticket-id <ticket_id>`
  - `ovld protocol load-context --ticket-id <ticketId>` → `ovld protocol load-context --ticket-id <ticket_id>`
  - `ovld protocol attach --ticket-id <ticketId>` → `ovld protocol attach --ticket-id <ticket_id>`
- [ ] Check the `argument-hint` fields (lines 47, 68, 89): keep `<ticket_id>` consistent everywhere.

### Layer 12 — Bundle templates (skill content embedded in installer)

File: `apps/desktop/electron/services/agent-bundle/templates.ts`

- [ ] All `$TICKET_ID` references in template strings (lines 36, 42, 54, 60, 76, 82, etc.) refer to the env var value — no code change needed since the env var will now hold the human-readable value.
- [ ] In any explanatory prose within template strings, replace mentions of "UUID" with "ticket identifier (e.g. `1:899`)" if they describe what `$TICKET_ID` contains.
- [ ] Confirm the `--ticket-id $TICKET_ID` shell fragments in templates remain syntactically correct after the value changes format (they will — it's just a different string).

### Layer 13 — Plugin skill docs

Files:
- `plugins/claude/skills/overlord-ticket/SKILL.md`
- `plugins/cursor/skills/overlord-ticket/SKILL.md`
- `plugins/overlord/skills/overlord-ticket/SKILL.md`

- [ ] In each SKILL.md, search for any prose that calls `$TICKET_ID` a "UUID" or implies it is one and update to "ticket identifier (e.g. `1:899`)".
- [ ] Confirm the attach example `ovld protocol attach --ticket-id $TICKET_ID` remains correct (it does — only the value changes).
- [ ] After changing templates, re-run `ovld setup claude`, `ovld setup cursor`, and `ovld setup codex` (or instruct users to do so) to push updated skill content to `~/.claude/skills/overlord-local/SKILL.md`, `~/.cursor/plugins/local/overlord/rules/overlord-local.mdc`, and the Codex plugin directory.

### Layer 14 — CONNECTOR_SURFACES.md command patterns

File: `ai/guidence/CONNECTOR_SURFACES.md`

- [ ] Claude Code local launch pattern (§ "Local launch path"): `ovld launch claude --ticket-id <id>` → `ovld launch claude --ticket-id <ticket_id>`
- [ ] Codex local launch pattern: `ovld launch codex --ticket-id <id>` → `ovld launch codex --ticket-id <ticket_id>`
- [ ] Cursor local launch pattern: `ovld launch cursor --ticket-id <id>` → `ovld launch cursor --ticket-id <ticket_id>`
- [ ] Gemini local launch pattern: `ovld launch gemini --ticket-id <id>` → `ovld launch gemini --ticket-id <ticket_id>`
- [ ] OpenCode local launch pattern: `ovld launch opencode --ticket-id <id>` → `ovld launch opencode --ticket-id <ticket_id>`
- [ ] Codex regression check (line ~502): `ovld launch ... --ticket-id <id>` → `--ticket-id <ticket_id>`
- [ ] Add a note to the Protocol surfaces section clarifying that `ticketId` in all three surfaces (API, CLI, MCP) now accepts `ticket_id` or UUID.

### Layer 15 — Ticket copy/quickstart UI surfaces

Files:
- `apps/web/components/features/CliQuickstart.tsx`
- `apps/web/components/features/TicketPanelHeader.tsx`
- `apps/mobile/app/(tabs)/tickets/[ticketId]/components/TicketDetailScreen.tsx`

- [ ] Wherever these components build copyable `ovld launch` commands, confirm they source the identifier from `ticket.ticket_id` (not `ticket.id`) so the copied command uses the human-readable format.
- [ ] If they use `buildLaunchCommands()` or `buildResumeCommands()` from `lib/overlord/launch-commands.ts`, the fix in Layer 7 covers them automatically.
- [ ] If they build command strings inline, update to use `ticket.ticket_id ?? ticket.id`.

### Layer 16 — Attach API response

File: `apps/web/app/api/protocol/attach/route.ts`

- [ ] Confirm the attach response already includes `ticket.ticket_id` in the returned ticket object (the current response does include it, verified from live attach output).
- [ ] No field additions needed — just verify `ticket_id` is not accidentally omitted from the select query or stripped in the response serialization.

### Layer 17 — Regression and compatibility

- [ ] After all changes: run attach with a UUID and confirm `resolveTicketId` still returns the correct ticket.
- [ ] Run attach with `ticket_id` format (`1:899`) and confirm it resolves correctly.
- [ ] Confirm that tickets with an empty or null `ticket_id` column fall back gracefully (context route passes UUID, which resolves fine).
- [ ] Confirm `ovld protocol attach --ticket-id 1:899` succeeds end-to-end with a real ticket.
- [ ] Confirm MCP `attach` call with `ticketId: "1:899"` succeeds end-to-end.
- [ ] Confirm the `SESSION_KEY=…` and any `TICKET_ID=…` stderr output from CLI commands contains the human-readable value after the migration.
