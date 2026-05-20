# Antigravity Connector Migration Plan

## Objective

Replace the deprecated Gemini CLI connector with an Antigravity CLI connector and move it from legacy slash-command-only behavior to durable plugin-backed behavior, with parity against the Claude, Codex, and Cursor connector surfaces where Antigravity supports the equivalent primitive.

## Inputs Reviewed

- `ai/guidence/CONNECTOR_SURFACES.md`
- `.claude/skills/agent-connector-update/SKILL.md`
- `.claude/skills/drift-review/SKILL.md`
- Existing connector implementations:
  - `packages/overlord-cli/bin/_cli/setup.mjs`
  - `apps/desktop/electron/services/agent-bundle/slash-commands.ts`
  - `apps/desktop/electron/services/agent-bundle/installer.ts`
  - `apps/desktop/electron/services/agent-launcher.ts`
  - `lib/overlord/launch-commands.ts`
  - `lib/overlord/agent-capabilities.ts`
  - `lib/helpers/agent-types.ts`
  - `apps/web/app/api/protocol/context/[ticketId]/route.ts`
  - `lib/overlord/ticket-prompt.ts`
- Antigravity CLI references:
  - Google Developers Blog, May 19, 2026: Gemini CLI is transitioning to Antigravity CLI; consumer Gemini CLI service ends June 18, 2026 for Google AI Pro/Ultra/free users; Antigravity CLI keeps Agent Skills, Hooks, Subagents, and Extensions as Antigravity plugins.
  - Google AI Gemini API key docs: Gemini API libraries automatically use `GEMINI_API_KEY` or `GOOGLE_API_KEY`; no `ANTIGRAVITY_API_KEY` variable is documented for Gemini API access.
  - Existing Overlord code: `supabase/functions/sync-agent-models/index.ts` uses `GEMINI_API_KEY` to query `https://generativelanguage.googleapis.com/v1beta/models`, while internal workflows such as feed-post generation, changelog drafting, commit-message generation, PR generation, Slack summarization, and ticket-title generation also use `GEMINI_API_KEY` for actual Gemini API calls.
  - Local `agy --help`: command is `agy`; launch flags include `--print`, `--prompt-interactive`, `--continue`, `--conversation`, `--add-dir`, `--sandbox`, and `--dangerously-skip-permissions`.
  - Local `agy plugin --help`: supports `list`, `import`, `install`, `uninstall`, `enable`, `disable`, `validate`, and `link`.
  - Local `agy plugin validate` on an installed Google plugin confirms Antigravity plugin validation recognizes `skills`, `agents`, `commands`, `mcpServers`, and `hooks`.

## Current State

Gemini is a legacy connector:

- Agent key: `gemini`
- UI label: Gemini / Gemini CLI
- Icon: `/images/icons/gemini.svg`
- Setup command: `ovld setup gemini`
- Managed files: TOML slash commands under `~/.gemini/commands/`
- Launch command: `gemini --include-directories <tmp> [--model] [--thinking-level] @<context-file>`
- Prompt mode: always full legacy workflow instructions
- Hook support: none
- MCP/plugin support: none
- Capability resolver: not bundle-supported

Antigravity should become a plugin-backed connector:

- Agent key: `antigravity`
- UI label: Antigravity
- Icon: `/images/icons/antigravity.svg`
- Setup command: `ovld setup antigravity`
- Managed plugin: Overlord plugin installed through Antigravity's plugin system
- Launch command: `agy ...`
- Prompt mode: bundle/slim when plugin is installed, legacy fallback when not installed
- Hook support: use Antigravity hooks for follow-up capture if the official hook event payload exposes a user-prompt event equivalent to Claude/Codex `UserPromptSubmit`; otherwise document the deliberate asymmetry and retain manual `user_follow_up` fallback.

## Compatibility Decision

Add `antigravity` as the primary connector and remove `gemini` as a deprecated compatibility alias.


Rationale:
no one uses `gemini` anymore, so we can remove it without breaking anything.

## API Key and Model Catalog Decision

Do not add `ANTIGRAVITY_API_KEY` unless official Antigravity CLI documentation or validated `agy` behavior requires it.

Current Overlord uses `GEMINI_API_KEY` for two different concerns:

- Model catalog discovery in `sync-agent-models`, via the public Gemini API models endpoint.
- Internal server-side Gemini generation workflows, including feed-post/changelog drafting and small text-generation helpers.

The migration should separate those concerns conceptually without inventing a new credential:

- Keep internal Gemini API workflows on `GEMINI_API_KEY`.
- For model catalog sync, either:
  - continue using `GEMINI_API_KEY` to discover Gemini-family models and write them under `agent_type='antigravity'` / `compatible_agents=['antigravity']`, if Antigravity launch supports choosing those model IDs; or
  - stop remote model discovery for Antigravity and represent it as Antigravity-managed/auto if the CLI model picker is tied to the user's Antigravity account/session rather than a public API key.
- Remove old `agent_type='gemini'` rows during the connector migration if Gemini support is being fully removed.
- If a future official Antigravity API exposes model listing behind a separate credential, introduce a clearly scoped variable at that time. Until then, `ANTIGRAVITY_API_KEY` should remain out of the implementation and docs.

## Migration Phases

### Phase 1: Confirm Antigravity Plugin Schema

Before code changes, create a throwaway plugin in `/private/tmp` and validate it with `agy plugin validate`.

Confirm:

- Required manifest filename and required fields.
- Canonical installed plugin directory. Local evidence suggests `agy plugin` initializes `~/.gemini/antigravity-cli`, while existing Antigravity IDE plugins live under `~/.gemini/config/plugins/`.
- Whether commands are Markdown, TOML, or another schema.
- Whether `mcpServers` can reference the existing local `overlord-mcp.mjs` shim.
- Hook schema and event names, especially whether there is a user-prompt submission hook that can call `/api/protocol/hook-event`.
- Whether plugin install can be done by copying files, or must shell to `agy plugin install`.
- Whether `agy` supports a machine-readable model list or model selection flag. If it does not, treat models as Antigravity-managed instead of querying a separate Antigravity API key.

Deliverable: a short note in the implementation PR explaining the validated Antigravity plugin paths and any unsupported parity items.

### Phase 2: Add Antigravity Agent Identity

Update agent identity surfaces:

- `lib/helpers/agent-types.ts`
  - Replace `gemini` with `antigravity` in `LaunchAgentType` and launch/copy selector values.
  - Remove Gemini identifiers from the supported connector list.
  - Use `/images/icons/antigravity.svg`.
- Any assigned-agent or model metadata using `gemini`
  - Add `antigravity` values.
  - Migrate or remove old `gemini` defaults and seeded values.
- Demo, marketing, docs, and screenshots copy
  - Replace "Gemini CLI" with "Antigravity CLI" where this is connector setup or launch guidance.
  - Keep historical/generic marketing mentions only where they are intentionally broad.

### Phase 3: Build Antigravity Plugin Bundle

Add mirrored plugin source directories:

- `plugins/antigravity/`
- `packages/overlord-cli/plugins/antigravity/`

Target contents after schema validation:

- `plugin.json` or the Antigravity-required manifest.
- `skills/overlord-ticket/SKILL.md`
  - Start from the Claude/Codex/Cursor workflow instructions.
  - Set Antigravity-specific language: `agy`, `ovld setup antigravity`, and plugin-backed workflow.
  - Include the same attach/update/ask/deliver/read-context/write-context/attachments/change-rationales guidance.
  - Include `ovld auth repair` and network/escalation guidance consistent with other connectors.
- `commands/`
  - Provide `connect`, `load`, `attach`, `discuss-objective`, `create`, `prompt`, and `record-work` if Antigravity plugin commands support this.
  - Preserve protocol semantics from the existing slash commands.
- `scripts/`
  - Reuse or adapt `user-prompt-submit-hook.sh` if Antigravity has an equivalent hook.
  - Reuse or copy `overlord-mcp.mjs` if Antigravity plugin MCP config can expose local tools.
- Hook/config files as required by Antigravity.

Version the plugin with the repo convention: `<!-- version: x.y.z -->` in markdown surfaces and a manifest version bump.

### Phase 4: Replace Setup and Doctor Wiring

Update setup/doctor surfaces:

- `packages/overlord-cli/bin/_cli/setup.mjs`
  - Add `antigravity` to `supportedAgents`.
  - Implement `installAntigravity()`, `uninstallAntigravity()` if needed, content hash, plugin version detection, and doctor status.
  - Make `ovld setup antigravity` the documented command.
  - Remove `ovld setup gemini`.
  - Include Antigravity in `ovld setup all` if plugin install is non-destructive and stable.
- `apps/desktop/electron/services/agent-bundle/installer.ts`
  - Add Antigravity plugin install/status/uninstall parity if Desktop settings should manage it.
- IPC surfaces if new Desktop install/status actions are needed:
  - `electron/ipc/app.ts`
  - `electron/preload.ts`
  - `types/electron.d.ts`

Do not keep installing legacy `~/.gemini/commands/*.toml` except during optional migration cleanup. If the Antigravity plugin command system replaces them, remove old Gemini-managed slash commands from the manifest during install.

### Phase 5: Update Launch Behavior

Update launch command generation:

- `apps/desktop/electron/services/agent-launcher.ts`
  - Replace Gemini branch with Antigravity branch.
  - Command should use `agy`.
  - Initial candidate command pattern:
    - Interactive launch: `agy --prompt-interactive "$(cat <context-file>)"`
    - If validated file references are supported: prefer context file reference plus `--add-dir <tmp>`.
  - Keep `OVERLORD_*`, `TICKET_ID`, `AGENT_IDENTIFIER`, `OVERLORD_LAUNCH_SESSION_ID` env vars.
  - Set `AGENT_IDENTIFIER=antigravity`.
  - Set `instructionMode=bundle` when plugin is installed.
- `packages/overlord-cli/bin/_cli/launcher.mjs`
  - Add `ovld launch antigravity`.
  - Remove `ovld launch gemini` from supported launch agents.
  - Use `agy` in emitted commands.
  - Re-check prompt-passing behavior in interactive and ask modes.
- `lib/overlord/launch-commands.ts`
  - Replace `gemini` command fields with `antigravity`.
  - Remove Gemini restart/copy command fields once the UI is switched.
  - Update restart support:
    - `agy --continue` for latest conversation.
    - `agy --conversation <id>` for explicit session ID, if `selectRestartSessionCommand()` has an external session id.
- Model/thinking flags:
  - `agy --help` does not expose `--model` or `--thinking-level`.
  - Treat Antigravity model/thinking as unsupported at launch unless official docs show a supported flag.
  - UI should either hide model/thinking controls for Antigravity or mark model as Antigravity-managed/auto.

### Phase 6: Update Prompt and Capability Routing

Update:

- `lib/overlord/agent-capabilities.ts`
  - Mark `antigravity` bundle-supported.
  - Keep `hasPermissionHook=false` unless Antigravity has a permission-request hook equivalent.
- `apps/web/app/api/protocol/context/[ticketId]/route.ts`
  - Accept `agent=antigravity`.
  - Remove `agent=gemini` after the UI and launcher stop emitting it.
- `lib/overlord/ticket-prompt.ts`
  - Add Antigravity-specific legacy and bundle prompt branches.
  - Bundle/slim prompt should match Claude/Codex/Cursor behavior.
  - Legacy fallback should inline full workflow instructions.
  - Manual follow-up fallback must remain explicit if hooks are missing or disabled.

### Phase 7: Update UI and Product Copy

Update all connector and launch UI:

- Onboarding:
  - `components/features/onboarding/steps/AgentSetupStep.tsx`
  - `ConnectorSetupStep.tsx`
  - `InstallAgentBundlesStep.tsx`
  - `ConfigureAgentPermissionsStep.tsx`
- Settings:
  - `components/modals/settings/AgentsAndMcpPage.tsx`
  - `components/modals/settings/CliPage.tsx`
- Ticket copy surfaces:
  - `apps/web/components/features/CliQuickstart.tsx`
  - `apps/web/components/features/TicketPanelHeader.tsx`
  - `apps/mobile/app/(tabs)/tickets/[ticketId]/components/TicketDetailScreen.tsx`
- Demo:
  - `app/demo/DemoSettings.tsx`
  - demo ticket/agent labels
- Docs:
  - `packages/overlord-cli/README.md`
  - `docs/public/users-guide.md`
  - `docs/public/new-user-onboarding.md`
  - `apps/web/app/docs/surfaces/agent-plugins/page.tsx`
  - `apps/web/app/docs/surfaces/cli/page.tsx`
  - `apps/web/app/docs/workflow/agent-execution/page.tsx`
  - `apps/web/app/docs/for-agents/*`

Copy should say:

- `ovld setup antigravity`
- `ovld launch antigravity --ticket-id <ticket_id>`
- Gemini CLI is deprecated for consumer users and removed from supported connector setup.
- Antigravity model selection is Antigravity-managed unless implementation validates supported `agy` model flags.

### Phase 7.5: Update Model Catalog Sync

Update `supabase/functions/sync-agent-models/index.ts` after the launch/model-selection behavior is validated:

- If `agy` accepts Gemini model IDs:
  - Rename `fetchGeminiModels()` or split it into provider-fetch versus agent-row mapping.
  - Continue querying the Gemini API with `GEMINI_API_KEY`.
  - Insert rows as `agent_type='antigravity'` and `capabilities.compatible_agents=['antigravity']`.
  - Remove stale `gemini` rows once the connector has been removed from the UI and launcher.
- If `agy` does not accept explicit model IDs:
  - Do not sync Antigravity rows from the Gemini API.
  - Add a static `auto` / `Antigravity default` option only if the selector requires a row for every launchable agent.
  - Hide or disable explicit model/thinking controls for Antigravity in the UI.
- Do not use `ANTIGRAVITY_API_KEY` for this phase unless official docs show that Antigravity CLI model discovery requires it.

### Phase 8: Update Connector Surface Inventory and Drift Skill

Update:

- `ai/guidence/CONNECTOR_SURFACES.md`
  - Replace the Gemini CLI section with Antigravity CLI.
  - Document managed plugin files, command patterns, hook support, MCP support, and any deliberate asymmetry.
  - Update the agent table, bundle support list, shared context checklist, setup checklist, settings UI checklist, and regression checks.
- `.claude/skills/agent-connector-update/SKILL.md`
  - Replace the five-agent list entry from Gemini CLI to Antigravity CLI.
  - Update path/checklist references to Antigravity plugin files.
- `.claude/skills/drift-review/SKILL.md`
  - Add Antigravity plugin paths to the surface extraction steps if they differ from existing plugin layouts.

### Phase 9: Migration Cleanup

On `ovld setup antigravity`:

- Detect legacy Overlord-managed Gemini slash command files:
  - `~/.gemini/commands/connect.toml`
  - `~/.gemini/commands/load.toml`
  - `~/.gemini/commands/attach.toml`
  - `~/.gemini/commands/discuss-objective.toml`
  - `~/.gemini/commands/create.toml`
  - `~/.gemini/commands/prompt.toml`
  - `~/.gemini/commands/record-work.toml`
- Remove only files that match the known Overlord-managed content hash or manifest entry.
- Remove the legacy Gemini manifest entry from `~/.ovld/bundle-manifest.json`.
- Do not delete user-created Gemini commands or non-Overlord Antigravity config.

### Phase 10: Verification

Automated checks:

- Typecheck/build surfaces touched by TypeScript changes.
- `agy plugin validate <overlord-antigravity-plugin-source>`.
- `ovld setup antigravity` installs plugin and reports up-to-date status.
- `ovld doctor antigravity` detects installed/partial/not-installed states.
- `ovld launch antigravity --ticket-id 1:1146 --launch-mode ask` emits an `agy` launch command.
- `ovld launch gemini --ticket-id 1:1146 --launch-mode ask` fails with a clear unsupported-agent error or migration message.
- Desktop launch context fetch uses `agent=antigravity` and `instructionMode=bundle` when installed.
- Antigravity plugin skill causes an agent to attach/update/deliver correctly.
- If hooks are implemented: user follow-up prompt posts to `/api/protocol/hook-event` and appears as `user_follow_up`.
- If MCP is implemented: local `attach`, `update`, `deliver`, and `record_work` tools work through the Antigravity plugin.

Manual checks:

- Settings install/repair/uninstall state for Antigravity.
- Onboarding text and docs no longer advertise Gemini CLI as the supported path.
- Seed/default assigned-agent values no longer create Gemini selections.
- Product pages use the Antigravity icon, not the Gemini icon, for the connector.

## Risks and Open Questions

- Antigravity plugin schema needs exact validation before implementation. Local CLI validation confirms high-level capabilities but not command/hook file shape.
- `agy --help` does not expose model/thinking flags, so model selection parity with Gemini likely cannot be preserved at CLI launch time.
- Hook parity depends on Antigravity exposing a user-prompt event. If hooks are lifecycle/tool-only, follow-up capture must remain a documented manual fallback.
- The canonical plugin install directory needs confirmation. Local evidence shows both `~/.gemini/config/plugins` and `~/.gemini/antigravity-cli` exist in the current installation path.
- Renaming persisted agent values from `gemini` to `antigravity` may require a database/data migration if stored assigned-agent fields are constrained or queried by exact string.

## Recommended First Implementation Slice

1. Validate plugin schema with `agy plugin validate`.
2. Add `plugins/antigravity` and package mirror with only skill + commands + MCP if supported.
3. Add setup/doctor/install support and legacy Gemini cleanup.
4. Switch launch command generation to `agy` and remove Gemini from supported launch agents.
5. Update capability routing so installed Antigravity plugin uses bundle prompts.
6. Update UI/docs/surface inventory.
7. Run drift review across connector surfaces before delivery.
