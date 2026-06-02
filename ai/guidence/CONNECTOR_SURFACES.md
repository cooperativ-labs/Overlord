# Connector Surfaces

This document is the parity checklist for every place Overlord integrates with each AI coding agent.

Use it before shipping any connector-related change. If one surface changes, check the others.

## Agents and connector models

| Agent       | Local connector                                                                             | Cloud/headless connector                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Overlord bundle (skill + permission hook + `UserPromptSubmit` hook) via `ovld setup claude` | `/api/mcp` with shared OAuth credentials; `OVERLORD_ORGANIZATION_ID` is only an explicit per-call override when a tool cannot infer scope |
| Codex       | Home-local chat plugin via Desktop app Settings → CLI                                       | `/api/mcp` with shared OAuth credentials; `OVERLORD_ORGANIZATION_ID` is only an explicit per-call override when a tool cannot infer scope (`~/.codex/config.toml`) |
| Cursor      | Local Cursor plugin via `ovld setup cursor`                                                 | —                                                                                                                                           |
| Antigravity CLI | Overlord plugin via `agy plugin install` / `ovld setup antigravity`                      | —                                                                                                                                           |
| OpenCode    | Overlord bundle (AGENTS.md + config) via `ovld setup opencode`                              | —                                                                                                                                           |
| Pi          | Direct CLI launch (no durable extension yet — full workflow inlined per launch)             | —                                                                                                                                           |

## Bundle support

Bundle-backed agents get a slim ticket prompt; unbundled agents always receive the full workflow instructions on every launch.

- **Bundle supported:** `claude`, `cursor`, `antigravity`, `opencode`
- **Legacy mode only:** `codex`, `pi`

Desktop local launches set `OVERLORD_SNAPSHOT_JSON` **only** when the user has enabled in-folder JJ version control (`project_user.local_version_control = jj`); the app then points snapshot metadata at the real working directory (after `GET /api/protocol/context/...`). There is no automatic managed/shadow jj workspace for projects that leave version control off. The context API does not run `jj` on the server. The CLI `attach` command creates a per-objective local git checkpoint at `refs/overlord/checkpoints/<objectiveId>` for git workspaces before work begins; `deliver` does not create a checkpoint.

Manual Run and auto-advance now create durable `execution_requests` rows. A local or remote `ovld runner start` process claims requests for its device/resource and launches them with the existing `ovld launch <agent>` primitive. Desktop terminal IPC remains available as a compatibility launch primitive, but the web Run button and deliver auto-advance path use the execution-request queue instead of requiring Electron to be open. CLI SSH launches remain the terminal-native surface via `ovld launch ... --ssh-command ... --remote-working-directory ...`, and queued requests can carry the same SSH fields for a runner to execute. Shared shell parsing, SSH TTY injection, escaping, and remote tmux wrapping live in [shell-utils.ts](/Users/jake/Development/Cooperativ/Overlord/lib/ssh/shell-utils.ts).

Registered project resource directories use `.overlord/project.json` as the durable local project metadata file. `.overlord/tmp/` and `.overlord/logs/` are reserved for local ephemeral agent data and must be gitignored; do not gitignore the full `.overlord/` directory.

Local desktop launches write context files and fallback hook/settings files into `.overlord/tmp/` when a project working directory is resolved, and export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to that same directory for the spawned agent process. Remote launches create `$REMOTE_WORKING_DIRECTORY/.overlord/tmp/` for the context file when a remote working directory is known, export the same temp env vars there, and fall back to remote system temp only when no project resource path is available.

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
- `~/.claude/overlord-permission-hook.sh` — legacy permission notification hook (mode 0755) removed during migration cleanup
- Claude local marketplace plugin copy under `~/.claude/plugins/cache/overlord-local/overlord/<version>/` — includes `hooks/hooks.json`, `scripts/permission-hook.sh`, and `scripts/user-prompt-submit-hook.sh`
- Runtime diagnostics: `~/.ovld/logs/user-prompt-submit-hook.log` — append-only hook trace for Claude/Codex follow-up submission attempts
- `~/.claude/settings.json` — existing user settings preserved; durable hooks now come from the installed plugin manifest rather than a temp settings merge

Checklist:

- Skill file is the canonical workflow instructions for bundle mode
- Hook script calls `$OVERLORD_URL/api/protocol/permission-request` when Claude awaits tool permission
- `UserPromptSubmit` hook calls `POST /api/protocol/hook-event` to capture follow-up messages and forward the Claude native `session_id` plus persisted `sessionKey` so `external_session_id` can be populated before delivery
- Settings merge preserves user's existing hooks and permissions (no clobber)
- Skill text tells the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Skill text tells the agent to run `ovld auth repair` itself on protocol/MCP auth failures before asking the user to log in again or proceed without Overlord updates
- Skill text tells the agent to try `ovld auth repair` before `ovld auth login` when shared credentials look stale; `--organization-id <id>` is optional and scopes a command/login validation without creating a stored default
- Slash command docs also tell the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Manifest entry written to `~/.ovld/bundle-manifest.json`

### 2. Slash commands

- Slash command installer:
  [slash-commands.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-bundle/slash-commands.ts)

Managed files (Markdown format):

- `~/.claude/commands/connect.md` — requires `--ticket-id`
- `~/.claude/commands/load.md` — requires `--ticket-id`
- `~/.claude/commands/attach.md` — requires `--ticket-id`
- `~/.claude/commands/discuss-objective.md` — requires `--ticket-id`
- `~/.claude/commands/add-objectives.md` — requires `--ticket-id` and ordered objectives JSON/file
- `~/.claude/commands/create.md`
- `~/.claude/commands/prompt.md`
- `~/.claude/commands/record-work.md` — invokes `ovld protocol record-work` for completed-from-chat work

### 3. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts) — also renders the local settings native command preview

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
- Desktop local launches export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to the resolved project `.overlord/tmp/` directory when a project working directory is known
- Desktop SSH launches use the same direct main-process command builder, omit local-only temp Claude settings/plugin paths on the remote host, and wrap the final remote agent command over system SSH

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
- Connector features list includes: skill (workflow protocol), permission hook, settings merge, slash commands, permission rules for `ovld protocol` and `.overlord/tmp`

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
- Runtime diagnostics: `~/.ovld/logs/user-prompt-submit-hook.log` — append-only hook trace for Claude/Codex follow-up submission attempts
- Plugin install manifest: `~/.ovld/overlord-plugin-manifest.json`

Checklist:

- Plugin install writes `~/.agents/plugins/marketplace.json`
- Plugin install writes `~/.codex/plugins/overlord`
- Plugin install rewrites `.codex-plugin/hooks.json` so `PermissionRequest` and `UserPromptSubmit` commands point at absolute installed script paths under `~/.codex/plugins/overlord/scripts/`, avoiding reliance on a Codex-provided plugin-root environment variable
- Plugin bundle includes `skills/`, `.codex-plugin/hooks.json`, `scripts/permission-hook.sh`, `scripts/user-prompt-submit-hook.sh`, and install-surface assets in `assets/`
- Plugin install manages `~/.codex/rules/default.rules`
- Plugin install removes any legacy Overlord-managed Codex `AGENTS.md` section
- Plugin install removes any legacy Codex bundle manifest entry from `~/.ovld/bundle-manifest.json`
- Skill text and MCP shim tell Codex to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Local MCP shim exposes the local runner queue tools (`request_execution`, `claim_execution`, `list_execution_requests`, `clear_execution_requests`, `complete_execution_launch`, `fail_execution_launch`) to match Antigravity's local shim. Hosted MCP intentionally leaves those runner tools out until hosted remote runners are supported end-to-end.

### 2. Local launch path

- Electron launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts) — also renders the local settings native command preview
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
- Prompt text explicitly includes the Codex ticket workflow instructions and the `## Task` metadata now includes the resolved current `Objective ID` alongside `Ticket ID`
- Local Codex plugin installs a `UserPromptSubmit` hook that records follow-up activity through `/api/protocol/hook-event` and forwards `CODEX_THREAD_ID` / `CODEX_SESSION_ID` to populate `external_session_id` when attach-time detection missed it
- Local Codex plugin installs a `PermissionRequest` hook that notifies Overlord through `/api/protocol/permission-request` (same blocking question event as Claude)
- Agent delivery narratives stay on the `deliver` event; the follow-on review `status_change` event uses generic transition text so the activity feed does not duplicate the delivery summary
- Prompt text does not tell Codex to look for `overlord-local` or a local Codex bundle
- Prompt text tells Codex to run `ovld auth repair` itself on protocol auth failures before asking the user to log in again or proceed without Overlord updates
- Prompt text tells Codex to try `ovld auth repair` before `ovld auth login` when shared credentials look stale; `--organization-id <id>` is optional and scopes a command/login validation without creating a stored default
- Thinking/effort flag uses `-c model_reasoning_effort=<value>` (TOML inline format)
- `--pre-command` runs through the user's interactive login shell (`$SHELL -ilc`) on POSIX before the Codex binary, so shell wrappers such as `agent-pod`, aliases, functions, and shell-initialized PATH entries resolve the same way they do in an interactive terminal. The shell must be interactive (`-i`), not just login (`-l`): zsh/bash only source `~/.zshrc` / `~/.bashrc` for interactive shells, which is where wrappers like agent-pod install their alias by default
- Desktop local launches intentionally stay on the direct Electron path instead of delegating to `ovld launch`; `ovld launch` is the copy/paste surface and remote shell entrypoint
- Desktop SSH launches use the same Codex expect/context-file behavior with the context file created on the remote host before Codex starts
- `ovld launch` exports `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to the resolved project `.overlord/tmp/` directory when `--working-directory` is provided or the current directory is a registered project

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
- Codex cloud instructions use shared OAuth credentials where supported; manual overrides may add `OVERLORD_ORGANIZATION_ID` only when a command needs an explicit single-org scope
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
- `ovld launch` uses project-local `.overlord/tmp/` as the agent temp root when it has an explicit working directory or is started inside a registered project; otherwise it falls back to the system temp directory

### 6. Demo / product copy

- Demo settings page:
  [DemoSettings.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/(marketing)/demo/DemoSettings.tsx)

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
- `~/.cursor/plugins/local/overlord/hooks/overlord-user-prompt-submit.sh`
- `~/.cursor/plugins/local/overlord/rules/overlord-local.mdc`
- `~/.cursor/plugins/local/overlord/commands/connect.md` — requires `--ticket-id`
- `~/.cursor/plugins/local/overlord/commands/load.md` — requires `--ticket-id`
- `~/.cursor/plugins/local/overlord/commands/spawn.md`
- `~/.cursor/plugins/local/overlord/commands/add-objectives.md` — requires `--ticket-id` and ordered objectives JSON/file
- `~/.cursor/plugins/local/overlord/commands/create.md`
- `~/.cursor/plugins/local/overlord/commands/prompt.md`
- `~/.cursor/plugins/local/overlord/commands/record-work.md` — invokes `ovld protocol record-work` for completed-from-chat work
- `~/.cursor/hooks.json` — merged `beforeSubmitPrompt` entry pointing at the plugin hook script
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
- `beforeSubmitPrompt` hook (Cursor IDE hooks) calls `POST /api/protocol/hook-event` when `TICKET_ID`, `OVERLORD_ACCESS_TOKEN`, and `OVERLORD_URL` / `OVERLORD_CONNECTOR_URL` are present in the agent environment (same contract as Claude/Codex `UserPromptSubmit`) and forwards Cursor `conversation_id` plus the persisted Overlord `sessionKey`
- Model flag: `--model` (no thinking/effort flag for Cursor)
- Desktop and CLI launches export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to the resolved project `.overlord/tmp/` directory when a project working directory is known

### 3. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)

Checklist:

- Onboarding advertises `ovld setup cursor` as the connector setup command
- Connector features list includes: local Cursor plugin install and permission rules for `ovld protocol`, `curl`, and `.overlord/tmp`
- Skill text tells the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Slash command docs also tell the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable

---

## Antigravity CLI connector surfaces

Antigravity CLI (`agy`) replaces the deprecated Gemini CLI connector. Overlord installs a managed plugin bundle (skill, Markdown slash commands, `UserPromptSubmit` hook, and local MCP shim) rather than legacy `~/.gemini/commands/*.toml` files.

### 1. Plugin installer

- Bundle installer:
  [installer.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-bundle/installer.ts)
- Plugin source (canonical):
  [plugins/antigravity](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity)
- Packaged copy (CLI/npm):
  [packages/overlord-cli/plugins/antigravity](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/plugins/antigravity)
- CLI install:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs) — `ovld setup antigravity`
- Legacy Gemini cleanup:
  [legacy-gemini-connector.cjs](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/legacy-gemini-connector.cjs)

Managed files:

- `~/.gemini/antigravity-cli/plugins/` — flattened plugin tree from `agy plugin install` (skill, commands, `plugin.json`, `hooks.json`, `mcp_config.json`)
- `~/.ovld/antigravity/scripts/overlord-mcp.mjs` — local MCP shim (staged from plugin source; absolute path injected into installed `plugin.json` / `mcp_config.json` because `agy plugin install` does not copy `scripts/`)
- `~/.ovld/antigravity/scripts/user-prompt-submit-hook.sh` — `UserPromptSubmit` hook script (installed hook `command` rewritten to this absolute path)
- `~/.gemini/policies/overlord-protocol.toml` — TOML policy allowing `ovld protocol` via `run_shell_command` (`commandPrefix = "ovld protocol"`, `decision = "allow"`)
- Runtime diagnostics: `~/.ovld/logs/antigravity-user-prompt-submit-hook.log` — append-only hook trace
- Manifest entry written to `~/.ovld/bundle-manifest.json` under `antigravity` (replaces deprecated `gemini` key)

Install flow checklist:

- `ovld setup antigravity` runs `agy plugin install <source>` (or `agy plugin import --force` when already present)
- Runtime scripts are staged under `~/.ovld/antigravity/scripts/` before install
- Post-install patch replaces `__OVERLORD_MCP_SCRIPT_PATH__` in MCP server args and rewrites hook `command` paths to absolute runtime script locations (not `${PLUGIN_ROOT}` — `agy` may not substitute it reliably)
- Policy file is written idempotently to `~/.gemini/policies/overlord-protocol.toml`
- Legacy migration removes only Overlord-managed Gemini artifacts: `~/.gemini/commands/*.toml` when content matches the known managed template, or paths listed on the deprecated `gemini` manifest entry. User-created Gemini commands are left intact.

### 2. Slash commands

Slash commands ship inside the Antigravity plugin (`commands/` directory), not via `slash-commands.ts`. They use Markdown with `$ARGUMENTS` (same convention as Claude/Cursor/OpenCode — **not** legacy Gemini TOML/`{{args}}`).

Managed command files (namespaced as `/overlord:<name>` in `agy`):

- `commands/connect.md` — requires ticket id
- `commands/load.md` — requires ticket id
- `commands/attach.md` — requires ticket id
- `commands/discuss-objective.md` — requires ticket id
- `commands/add-objectives.md` — requires ticket id and ordered objectives JSON/file
- `commands/create.md`
- `commands/prompt.md`
- `commands/record-work.md` — invokes `ovld protocol record-work`

### 3. MCP shim

- Local MCP shim:
  [overlord-mcp.mjs](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/scripts/overlord-mcp.mjs)
- Registered in installed `plugin.json` → `mcpServers.overlord` (args patched to `~/.ovld/antigravity/scripts/overlord-mcp.mjs`)

Checklist:

- Shim shells out to `ovld protocol` with snake_case MCP parameters mapped to kebab-case CLI flags (same pattern as the Codex plugin shim, separate file)
- Exposes the full local protocol surface agents need (`attach`, `update`, `deliver`, `ask`, ticket search, attachments, device/resource tools, and runner queue tools)
- Hosted `/api/mcp` is **not** the Antigravity local path — Antigravity uses the bundled local shim only

### 4. Hooks

- Hook manifest:
  [hooks.json](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/hooks/hooks.json)
- Hook script:
  [user-prompt-submit-hook.sh](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/scripts/user-prompt-submit-hook.sh)

Checklist:

- `UserPromptSubmit` calls `POST /api/protocol/hook-event` when `OVERLORD_URL`, `OVERLORD_ACCESS_TOKEN`, and `TICKET_ID` are set (same contract as Claude/Codex/Cursor follow-up capture) and forwards Antigravity `session_id` plus the persisted Overlord `sessionKey`
- Hook skips turn index 0 (initial injected ticket prompt) via file-based session state under `~/.ovld/antigravity-user-prompt-hook/`
- **No permission hook** — Antigravity has no `PermissionRequest` equivalent wired to Overlord
- Skill text tells the agent to request permission escalation or network access before retrying if `OVERLORD_URL` is unreachable
- Skill text tells the agent to run `ovld auth repair` itself on protocol/MCP auth failures before asking the user to log in again

### 5. Plugin skill

- Skill doc:
  [plugins/antigravity/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/skills/overlord-ticket/SKILL.md)

Checklist:

- Skill is loaded automatically by `agy` when the plugin is installed
- Documents `ovld protocol` workflow for both Overlord-launched tickets and chat-invoked work
- Keep in sync with Claude/Cursor/Codex `overlord-ticket` skills when protocol behavior changes

### 6. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts) — also renders the local settings native command preview

Command pattern:

```
agy --prompt-interactive @<context-file> --add-dir <tmpdir>

ovld launch antigravity --ticket-id <ticket_id> [--working-directory <path>] [--flag <value> ...]
agy --continue | agy --conversation <id>   # native resume (also: ovld restart antigravity)
```

Checklist:

- Bundle supported when Antigravity plugin is installed (`instructionMode=bundle`); legacy full prompt when not installed
- Context route accepts `agent=antigravity`
- No model/thinking launch flags — Antigravity manages models internally
- Desktop local launches intentionally stay on the direct Electron path; `ovld launch antigravity` is the copy/paste and remote-shell entrypoint
- Desktop SSH launches keep Antigravity's no-model/no-thinking asymmetry and pass the remote context file to `agy --prompt-interactive`
- Antigravity receives `--add-dir <project>/.overlord/tmp` when a project working directory is known, and desktop/CLI launches export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to that same directory

### 7. Deliberate asymmetries

- **No permission hook** — protocol access is policy-based (`overlord-protocol.toml`), not a blocking permission-request event
- **No hosted MCP path** — local `overlord-mcp.mjs` shim only (unlike Codex cloud headless)
- **No `slash-commands.ts` installer** — commands live in the plugin bundle installed by `agy`
- **Runtime scripts outside plugin tree** — MCP and hook scripts must live under `~/.ovld/antigravity/scripts/` with post-install absolute path patching
- **Legacy Gemini paths** — Antigravity still uses `~/.gemini/` for plugin and policy directories (Antigravity CLI convention), but the connector id is `antigravity`, not `gemini`
- **No thinking/effort flags** on launch commands

### 8. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/onboarding/steps/ConnectorSetupStep.tsx)
- Permission step (policy only):
  [ConfigureAgentPermissionsStep.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/onboarding/steps/ConfigureAgentPermissionsStep.tsx)

Checklist:

- Onboarding advertises `npm install -g @antigravity/cli` then `ovld setup antigravity`
- Connector features list includes: plugin install (skill, slash commands, hook, MCP), protocol policy rules, `ovld launch antigravity`
- No references to `ovld setup gemini` or Gemini TOML slash commands in user-facing copy

### 9. Demo / product copy

- Demo settings page:
  [DemoSettings.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/(marketing)/demo/DemoSettings.tsx)

Checklist:

- Demo copy describes the Antigravity plugin install path, not legacy Gemini commands
- Demo managed-file list matches real installer outputs (`plugin.json`, `hooks.json`, runtime scripts, policy file)

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
- `~/.config/opencode/opencode.json` — `instructions` array and `permission.bash` map merged (allows `ovld protocol *`, `curl -sS -X POST *`, `curl -s -X POST *`, and `.overlord/tmp` scratch commands)

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
- `~/.config/opencode/commands/add-objectives.md` — requires `--ticket-id` and ordered objectives JSON/file
- `~/.config/opencode/commands/create.md`
- `~/.config/opencode/commands/prompt.md`
- `~/.config/opencode/commands/record-work.md` — invokes `ovld protocol record-work` for completed-from-chat work

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
- Desktop and CLI launches export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to the resolved project `.overlord/tmp/` directory when a project working directory is known

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

## Pi connector surfaces

### 1. Local launch path

- Launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts)
- Human CLI launcher:
  [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder:
  [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts) — also renders the local settings native command preview

Command pattern:

```
pi [--model <model>] [--thinking <level>] "$(cat <context-file>)"

ovld launch pi --ticket-id <ticket_id> [--working-directory <path>] [--model <model>] [--thinking <level>] [--flag <value> ...]
```

Checklist:

- No bundle support yet — full workflow instructions always included in the prompt (`instructionMode=legacy`)
- No permission hook
- Model flag: `--model`; thinking flag: `--thinking` (off, minimal, low, medium, high, xhigh)
- Native resume command: `pi --resume <session-id>` (used by `selectRestartSessionCommand`)
- A dedicated Pi extension package installed under `~/.pi/agent/extensions/overlord/` is planned as a follow-up to promote Pi to bundle mode
- Desktop and CLI launches export `TMPDIR`, `TMP`, `TEMP`, and `OVERLORD_TMPDIR` to the resolved project `.overlord/tmp/` directory when a project working directory is known

### 2. Onboarding

- Agent setup step:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install step:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/onboarding/steps/ConnectorSetupStep.tsx)

Checklist:

- Onboarding lists Pi as an installable CLI agent with install command `npm install -g @earendil-works/pi-coding-agent`
- Connector copy makes clear Pi has no durable extension yet — workflow ships inline on every launch
- No `ovld setup pi` is advertised because there are no managed files to install in this iteration

---

## Protocol surfaces (parity matrix)

The Overlord protocol is exposed across three call surfaces. Keep them aligned —
when one surface changes, check the others against this table.

| Operation                     | API route                                         | CLI subcommand                   | MCP tool                                       |
| ----------------------------- | ------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| auth-status                   | —                                                 | `ovld protocol auth-status`      | — (CLI/human-only)                             |
| discover-project              | `POST /api/protocol/discover-project`             | `discover-project`               | `discover_project`                             |
| attach                        | `POST /api/protocol/attach`                       | `attach`                         | `attach`                                       |
| connect                       | `POST /api/protocol/connect`                      | `connect`                        | `connect` (local `overlord-mcp.mjs` shim only) |
| load-context                  | `POST /api/protocol/load-context`                 | `load-context`                   | `load_ticket_context` (local shim only)        |
| revert                        | `POST /api/protocol/revert`                       | `revert`                         | `revert` (local shim only; restores local git) |
| search-tickets                | `POST /api/protocol/search-tickets`               | `search-tickets`                 | `search_tickets`                               |
| discuss-objective             | `POST /api/protocol/discuss-objective`            | `discuss-objective`              | `discuss_objective`                            |
| add-objectives                | `POST /api/protocol/add-objectives`               | `add-objectives`                 | `add_objectives`                               |
| create (follow-up)            | `POST /api/protocol/create-ticket`                | `create` (with session flags)    | `create_ticket`                                |
| create (standalone)           | `POST /api/protocol/tickets`                      | `create` (no session flags)      | `create_ticket` (local shim only)              |
| prompt                        | `POST /api/protocol/prompt`                       | `prompt`                         | `prompt` (local shim only)                     |
| record-work                   | `POST /api/protocol/record-work`                  | `record-work`                    | `record_work`                                  |
| update                        | `POST /api/protocol/update`                       | `update`                         | `update`                                       |
| heartbeat                     | `POST /api/protocol/heartbeat`                    | `heartbeat`                      | `heartbeat`                                    |
| hook-event                    | `POST /api/protocol/hook-event`                   | `hook-event`                     | `record_hook_event`                            |
| record-change-rationales      | `POST /api/protocol/record-change-rationales`     | `record-change-rationales`       | `record_change_rationales`                     |
| ask                           | `POST /api/protocol/ask`                          | `ask`                            | `ask`                                          |
| permission-request            | `POST /api/protocol/permission-request`           | `permission-request` (hook-only) | —                                              |
| request-execution             | `POST /api/protocol/request-execution`             | `request-execution`              | `request_execution` (local shim)               |
| claim-execution               | `POST /api/protocol/claim-execution`               | `claim-execution`                | `claim_execution` (local shim)                 |
| list-execution-requests       | `POST /api/protocol/list-execution-requests`       | `list-execution-requests`        | `list_execution_requests` (local shim)         |
| clear-execution-requests      | `POST /api/protocol/clear-execution-requests`      | `clear-execution-requests`       | `clear_execution_requests` (local shim)        |
| complete-execution-launch     | `POST /api/protocol/complete-execution-launch`     | `complete-execution-launch`      | `complete_execution_launch` (local shim)       |
| fail-execution-launch         | `POST /api/protocol/fail-execution-launch`         | `fail-execution-launch`          | `fail_execution_launch` (local shim)           |
| read-context                  | `POST /api/protocol/read-context`                 | `read-context`                   | `read_context`                                 |
| write-context                 | `POST /api/protocol/write-context`                | `write-context`                  | `write_context`                                |
| deliver                       | `POST /api/protocol/deliver`                      | `deliver`                        | `deliver`                                      |
| attachment prepare            | `POST /api/protocol/attachments/prepare-upload`   | `attachment-prepare-upload`      | `prepare_attachment_upload`                    |
| attachment finalize           | `POST /api/protocol/attachments/finalize-upload`  | `attachment-finalize-upload`     | `finalize_attachment_upload`                   |
| attachment upload (composite) | — (client-side)                                   | `attachment-upload-file`         | `upload_attachment_file`                       |
| attachment download URL       | `POST /api/protocol/attachments/get-download-url` | `attachment-download-url`        | `get_attachment_download_url`                  |
| context fetch                 | `GET/POST /api/protocol/context/[ticketId]`       | —                                | — (UI-private)                                 |
| projects (list)               | `GET /api/protocol/projects`                      | —                                | — (UI-private)                                 |

Notes:

- **Parameter naming:** Supabase Edge MCP (`/Users/jake/Development/Cooperativ/Overlord/supabase/functions/mcp/tools.ts`) uses **camelCase** tool arguments that match `POST /api/protocol/*` JSON bodies (`ticketId`, `sessionKey`, `changeRationales`, …). The local Codex MCP shim (`/Users/jake/Development/Cooperativ/Overlord/plugins/overlord/scripts/overlord-mcp.mjs`) uses **snake_case** keys that map to `ovld protocol` kebab-case flags (`ticket_id` → `--ticket-id`). Prefer camelCase when calling the hosted MCP endpoint and snake_case when calling the shim.
- `discover-project` accepts `projectId` / `--project-id` / `project_id` as an explicit shortcut, or `workingDirectory` / `--working-directory` / `working_directory` for path matching. Device identity fields (`deviceFingerprint`, `deviceHostname`, `devicePlatform`) are accepted across API, CLI, hosted MCP, and local shims so directory matching can prefer resource directories for the current device.
- `agentIdentifier` and `connectionMethod` are required by the API but defaulted client-side: CLI defaults to `<agent>`/`cli`, MCP defaults to `mcp`.
- `externalSessionId` is accepted on `attach`, `connect`, `update`, `heartbeat`, and `hook-event`, allowing active sessions to expose a native resume id before delivery.
- Organization scope is never stored as a default. Ticket-scoped protocol calls resolve from the organization id embedded in human-readable `ticket_id` (for example `1:899`) before auth. Sessionless object-scoped calls resolve from stable object ids such as `projectId`, `resourceId`, `objectiveId`, or `requestId`; browse/search flows fan out across memberships. Explicit `--organization-id` / `x-organization-id` remains a single-org override and must name an organization the identity belongs to.
- `deliver` accepts optional `artifacts` (defaults to `[]`), `changeRationales`, `snapshot`, and `checkpoint` metadata — same as `deliverSchema` in `/Users/jake/Development/Cooperativ/Overlord/lib/overlord/validation.ts`. The CLI can send the full delivery object via `--payload-json <json>` or `--payload-file <path|->`; when either full-payload flag is used, do not also pass `--summary`, `--artifacts-*`, or `--change-rationales-*`. Local git checkpoints are created on `attach` (per executing objective), not `deliver`; `--skip-checkpoint` is an `attach` flag.
- Objective arrays are accepted on `create`, `prompt`, and `record-work` as ordered `objectives` arrays of `{ objective, title?, autoAdvance?, assignedAgent? }`. CLI flags are `--objectives-json` / `--objectives-file`; hosted MCP uses camelCase fields and the local shim uses snake_case inputs mapped to those CLI flags.
- `add-objectives` appends ordered objectives to an existing ticket. Index 0 is the first newly added objective to execute; later indexes queue after it. Agent docs must distinguish this from creating multiple tickets: use multiple tickets for different features/goals, and same-ticket objectives for sequential steps toward one feature/goal.
- `record-work` is the completed-from-chat path. Use it when work is already done and you need a ticket in `review` plus feed-post generation without opening an attached session. Keep its required fields (`objective` or `objectives`, `summary`) and project-resolution behavior aligned across API, CLI, hosted MCP, the local shim, and plugin guidance.
- `revert` is local-destructive by design: the API only returns the checkpoint row for `objectiveId`; the CLI/local shim restores the caller's working tree and saves a safety ref under `refs/overlord/safety/`. Hosted MCP does not expose it because it cannot mutate the user's local repository.
- `permission-request` is invoked by the installed permission hook/rules, not by agent logic.
- Execution request operations back `ovld runner`. `request-execution` is the durable launch contract used by manual Run and auto-advance; `claim-execution`, `complete-execution-launch`, and `fail-execution-launch` are runner operations and are exposed in the CLI/local MCP shims for headless devices. Hosted MCP exposure is intentionally deferred until hosted remote runners are supported end-to-end.
- Attachment calls accept an optional ticket id. Agents can omit it when `objectiveId`/`objective_id` or `attachmentId`/`attachment_id` is enough for the server to derive ticket scope.
- `update` accepts `beginFollowUpWork` / `--begin-follow-up-work` / `begin_follow_up_work` and `followUpIntent` / `--follow-up-intent` / `follow_up_intent` (`discussion`, `execution`, `pending_delivery`). A delivered/review ticket can only be moved back to execute through this explicit begin-follow-up-work transition; ordinary questions, answers, clarifications, and decisions stay as ticket events in discussion intent.
- `heartbeat` is intentionally session-scoped, not event-scoped. It updates `agent_sessions.heartbeat_at` and stores transient `phase` / `percent` / `note` telemetry on the session row without creating a `ticket_events` history entry.
- After a prior `deliver`, execution updates, git snapshots, rationale rows, deliverable payloads, or explicit `pending_delivery` intent mark the current objective `pending_delivery`. The transition itself does not count as work, so redelivery is required only when follow-up execution produced something meaningful after the previous delivery.
- `update` event types include `discussion_summary` and `decision` in addition to `update`, `user_follow_up`, and `alert`, so important non-file follow-up outcomes can be recorded without treating them as execution.
- `hook-event` is invoked by installed lifecycle hooks (`UserPromptSubmit` and `Stop`). `UserPromptSubmit` follow-up captures default to `followUpIntent=discussion` and may also carry `externalSessionId` plus `sessionKey` so the current `agent_sessions.external_session_id` is updated as soon as the runtime exposes a native resume id. `Stop` fires when the agent's turn ends; when called with an optional `sessionKey`, the response includes `deliveryStatus` indicating whether the session has pending work that should be delivered. The check is non-blocking and does not force delivery after every message.
- `prompt` (formerly `spawn`) creates and executes a ticket immediately. The CLI accepts `spawn` as a backward-compatible alias.
- MCP objective attachment tools follow `<verb>_<noun>` naming. CLI subcommands keep the `attachment-*` shape for terminal ergonomics. (`artifacts` is reserved for the structured records agents submit via `deliver`, not user-uploaded files.)
- `GET /context/[ticketId]` and `GET /projects` are intentionally UI-only (Overlord desktop/web). They are marked `// UI-private — not exposed via CLI/MCP by design` in code so future drift audits don't re-flag them.
- `discuss-objective` transitions a draft objective to `submitted` state, indicating the ticket is in active discussion with an agent. It does NOT create a session or start execution — that requires `attach`. Agents should call it when discussing or opening a ticket, not when the user orders execution.

Source-of-truth files:

- API routes: [apps/web/app/api/protocol/](/Users/jake/Development/Cooperativ/Overlord/apps/web/app/api/protocol)
- CLI dispatcher: [protocol.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/protocol.mjs)
- CLI runner: [runner.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/runner.mjs)
- Human CLI launcher: [launcher.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs)
- Shared copy-command builder: [launch-commands.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts)
- MCP tool definitions: [tools.ts](/Users/jake/Development/Cooperativ/Overlord/supabase/functions/mcp/tools.ts)
- Agent plugin template source: [plugins/_source/agents/](/Users/jake/Development/Cooperativ/Overlord/plugins/_source/agents) plus [plugins/_source/shared/](/Users/jake/Development/Cooperativ/Overlord/plugins/_source/shared) render Claude, Cursor, and Codex plugin outputs with [render-agent-plugins.mjs](/Users/jake/Development/Cooperativ/Overlord/scripts/render-agent-plugins.mjs)
- Local Codex MCP shim: [overlord-mcp.mjs](/Users/jake/Development/Cooperativ/Overlord/plugins/overlord/scripts/overlord-mcp.mjs)
- Plugin skill docs: [plugins/claude/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/claude/skills/overlord-ticket/SKILL.md), [plugins/cursor/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/cursor/skills/overlord-ticket/SKILL.md), [plugins/overlord/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/overlord/skills/overlord-ticket/SKILL.md), [plugins/antigravity/skills/overlord-ticket/SKILL.md](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/skills/overlord-ticket/SKILL.md)
- Antigravity local MCP shim: [overlord-mcp.mjs](/Users/jake/Development/Cooperativ/Overlord/plugins/antigravity/scripts/overlord-mcp.mjs)

Claude, Cursor, and Codex committed plugin outputs are generated from `plugins/_source/agents/` plus shared include templates in `plugins/_source/shared/` into both `plugins/` and `packages/overlord-cli/plugins/`. Run `yarn plugins:render` after changing those templates and `yarn plugins:check` before shipping; CI runs the same drift check. The `packages/overlord-cli` package also runs `yarn plugins:check` as a `prepack` hook so `npm pack` / `npm publish` will fail if the committed plugin outputs are stale. Antigravity remains a direct committed plugin tree until its follow-on migration objective moves it into the renderer.

Each generated agent SKILL.md uses progressive disclosure: rules and workflow decision trees load eagerly, while verbose command reference, MCP naming, device management, context/attachment commands, and shell-escaping examples live in `reference/*.md` files that agents fetch on demand. Claude gets 5 reference files (cli, mcp, devices, context, shell-escaping); Cursor and Codex get 4 (no shell-escaping).

## Shared surfaces

### Context route and prompt builder

- Context route:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts)
- Prompt builder:
  [ticket-prompt.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- Capability resolver:
  [agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

Checklist:

- Context route accepts `agent=` query param for all 6 agents: `claude`, `codex`, `cursor`, `antigravity`, `opencode`, `pi`
- `instructionMode=bundle` is sent for `claude`, `cursor`, `antigravity`, and `opencode` when their bundle/plugin is installed
- `instructionMode=legacy` is used for `codex`, `pi`, and for `claude`/`cursor`/`antigravity`/`opencode` when bundle/plugin is not installed
- Prompt content varies per agent — verify agent-specific workflow sections when changing `ticket-prompt.ts`

### CLI setup command

- Setup command:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs)

Checklist:

- `ovld setup claude` installs bundle for Claude Code
- `ovld setup codex` installs the local Codex plugin bundle
- `ovld setup opencode` installs bundle for OpenCode
- `ovld setup cursor` installs Cursor local plugin and permission allow rules
- `ovld setup antigravity` installs the Antigravity plugin via `agy plugin install` and protocol policy rules
- `ovld setup all` installs all supported agents (`claude`, `codex`, `cursor`, `antigravity`, `opencode`)
- `ovld doctor` validates installed bundle statuses for `claude`, `codex`, `cursor`, `antigravity`, and `opencode` (Pi is launch-only — no managed files to validate yet)

### Settings UI

- Agents & MCP page:
  [AgentsAndMcpPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/AgentsAndMcpPage.tsx)
- CLI settings page:
  [CliPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx)
- Ticket copy surfaces:
  [CliQuickstart.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/CliQuickstart.tsx)
  [TicketPanelHeader.tsx](/Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/TicketPanelHeader.tsx)
  [TicketDetailScreen.tsx](</Users/jake/Development/Cooperativ/Overlord/apps/mobile/app/(tabs)/tickets/[ticketId]/components/TicketDetailScreen.tsx>)

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

**Antigravity CLI**

- Plugin installed to `~/.gemini/antigravity-cli/plugins/` via `agy plugin install`
- Runtime MCP/hook scripts staged under `~/.ovld/antigravity/scripts/` with absolute paths patched post-install
- MCP shim and `UserPromptSubmit` hook fire against `/api/protocol/*` when launcher env vars are set
- Launching Antigravity from Overlord uses slim prompt when plugin is installed (`instructionMode=bundle`)
- Legacy `~/.gemini/commands/*.toml` removed on setup migration; no user-facing `ovld setup gemini`
- Copyable ticket commands use `ovld launch antigravity --ticket-id <ticket_id>` (no `--model` / `--thinking` flags)

**OpenCode**

- Bundle status in Settings reflects AGENTS.md section and opencode.json merge
- Launching OpenCode from Overlord produces correct prompt (slim for bundle mode, full for legacy)
- Slash commands written to `~/.config/opencode/commands/` (Markdown with `agent: build` frontmatter)
- `--prompt` flag is present in the launch command

**Pi**

- Launching Pi from Overlord runs `pi "$(cat <context-file>)"` with the full legacy workflow prompt
- Model flag is `--model`; thinking flag is `--thinking`
- Resume uses native `pi --resume <session-id>` when an external session id is available
- No managed files; `ovld setup pi`, `ovld doctor` Pi checks, and a permission hook are not implemented in this iteration

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
- [ ] Antigravity local launch pattern: `ovld launch antigravity --ticket-id <id>` → `ovld launch antigravity --ticket-id <ticket_id>`
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
