# Cursor Plugin Connector Investigation

Date: 2026-04-17

## Question

Should Overlord implement a Cursor plugin-based connector instead of the current Cursor bundle/rules connector?

Primary use case: make `cursor-agent` running in a terminal know how to interact with Overlord in the most robust and token-efficient way. Cloud-hosted Cursor/plugin distribution is not the current focus, but should remain compatible with the future roadmap.

## Current Overlord Cursor Connector

Overlord currently manages Cursor through scattered home-local files:

- `~/.cursor/rules/overlord-local.mdc`
- `~/.cursor/commands/connect.md`
- `~/.cursor/commands/load.md`
- `~/.cursor/commands/spawn.md`
- `~/.cursor/settings.json` permission allow entries for `ovld protocol` and `curl -sS -X POST`
- `~/.ovld/bundle-manifest.json` metadata

The implementation lives primarily in:

- `apps/desktop/electron/services/agent-bundle/installer.ts`
- `apps/desktop/electron/services/agent-bundle/templates.ts`
- `apps/desktop/electron/services/agent-bundle/slash-commands.ts`
- `apps/desktop/electron/services/agent-permissions.ts`
- `packages/overlord-cli/bin/_cli/setup.mjs`

This works, but it has the usual bundle drawbacks: install state is split across several Cursor-owned directories, updates need custom manifest tracking, and users cannot see Overlord as a first-class Cursor plugin in Settings.

One important current mismatch: `prepareAgentLaunch()` treats an installed Cursor rule bundle as `instructionMode=bundle`, and `ticket-prompt.ts` then emits the shared bundled prompt. That prompt currently says "Use the Overlord Claude plugin loaded for this session" and references `overlord:overlord-ticket-workflow`. That wording is wrong for Cursor and should be corrected regardless of whether the Cursor plugin migration happens.

## Cursor Plugin Findings

Cursor now has a first-class plugin marketplace and local plugin format. The public marketplace shows plugins bundling MCP, skills, rules, and commands for products such as Figma, Sanity, Sourcegraph, and others:

- https://cursor.com/marketplace

Cursor staff guidance for local testing says the plugin should live at:

```text
~/.cursor/plugins/local/<plugin-name>/
```

with this shape:

```text
.cursor-plugin/plugin.json
skills/
mcp.json
```

After copying the plugin there, users restart Cursor or run `Developer: Reload Window`, and the plugin appears in Settings > Plugins under Installed:

- https://forum.cursor.com/t/local-plugin-is-not-being-picked-up-by-cursor/156549/3

Cursor staff guidance for marketplace submission says the flow is:

1. Build the plugin with `.cursor-plugin/plugin.json`.
2. Test locally from `~/.cursor/plugins/local`.
3. Host it in a public Git repository.
4. Submit the repository link at `https://cursor.com/marketplace/publish`.

Marketplace submissions are manually reviewed for security, quality, and data handling, and public/open-source hosting is currently expected:

- https://forum.cursor.com/t/how-do-i-upload-my-plugin-after-filling-out-the-form-there-are-no-buttons-am-i-doing-something-wrong/155138

## Recommendation

Yes, implement a Cursor plugin-based connector, but optimize the first version for local terminal `cursor-agent` sessions rather than marketplace or cloud distribution.

The plugin route is the better long-term fit because it can package the same Overlord workflow as a single Cursor-native install surface:

- Rules: current `overlord-local.mdc`
- Commands: `connect`, `load`, `spawn`
- Skills: `overlord-ticket-workflow`
- MCP: local bridge to the existing `ovld protocol` CLI
- Assets/metadata: first-class Settings > Plugins presentation

For the terminal use case, the core value is prompt compression and durability: once Cursor has a local Overlord rule/skill/plugin installed, launched tickets can use a slim prompt that says "attach, then follow the installed Overlord workflow" instead of embedding the full protocol walkthrough every time. This mirrors the Codex plugin and Claude/OpenCode bundle strategy and reduces repeated token load in every ticket prompt.

The migration should not be an immediate hard replacement because Cursor plugin behavior is still relatively new and terminal/plugin discovery must be verified directly with `cursor-agent`. The current connector remains useful for older Cursor versions, users who do not want plugin installs, and environments where plugin loading is unreliable.

Cloud and marketplace support should be treated as a later distribution layer. The local terminal path should work first with `ovld setup cursor` and local files under `~/.cursor`.

## Proposed Package Shape

Add a dedicated Cursor plugin package, separate from the Codex plugin:

```text
plugins/cursor/
  .cursor-plugin/plugin.json
  rules/overlord-local.mdc
  commands/connect.md
  commands/load.md
  commands/spawn.md
  skills/overlord-ticket-workflow/SKILL.md
  mcp.json
  scripts/overlord-mcp.mjs
  assets/
  README.md
```

Prefer copying the plugin into `~/.cursor/plugins/local/overlord` for reliability. Symlinks are useful for development but have had inconsistent reports in Cursor local plugin testing.

## Implementation Plan

1. Create `plugins/cursor` from the current Cursor rule, slash commands, and the existing Overlord MCP bridge used by the Codex plugin.
2. Add Cursor plugin install/status/repair/uninstall logic that manages `~/.cursor/plugins/local/overlord`.
3. Keep writing `~/.cursor/settings.json` permission allow entries outside the plugin unless Cursor documents a plugin-owned permission mechanism.
4. Update `ovld setup cursor` and desktop Settings to install the plugin for local terminal usage, with a legacy scattered-file fallback.
5. Track plugin install state in the Overlord manifest with content hashes over the plugin directory.
6. Update `prepareAgentLaunch()` / context generation so installed Cursor plugin mode emits a slim terminal prompt for `cursor-agent`: attach first, then follow the installed Overlord Cursor workflow.
7. Update `lib/overlord/ticket-prompt.ts` so Cursor bundle/plugin mode references the Cursor plugin or Cursor rule/skill by name, not the Claude plugin.
8. Update `apps/web/components/modals/settings/CliPage.tsx` so the Desktop app Settings UI describes and manages the new Cursor plugin install path consistently with CLI behavior.
9. Update `lib/agent-connectors` surfaces so Cursor connector metadata, install instructions, MCP/auth snippets, or related connector helpers stay aligned with the plugin-based local terminal path.
10. Update `apps/web/components/features/onboarding/steps/ConnectorSetupStep.tsx` so onboarding installs, statuses, feature labels, and repair flows match the Cursor plugin connector.
11. Audit the other connector surfaces listed in `docs/CONNECTOR_SURFACES.md`, including CLI setup/help, desktop bundle/plugin services, permission setup, demo copy, docs pages, launch commands, and tests, so the CLI and Desktop app remain fully compatible.
12. Add regression coverage for install status, managed files, prompt text, CLI setup output, Desktop Settings/onboarding copy, and the `cursor-agent` launch prompt size/path.
13. Verify with local `cursor-agent` before considering any marketplace submission.
14. Later, revisit cloud and marketplace packaging once the local terminal path is stable.

## Decision

Implement the Cursor plugin connector next for local terminal `cursor-agent`, but ship it behind a compatibility path rather than removing the existing connector immediately. The success criterion is that `ovld setup cursor` produces a Cursor-native local install that lets `cursor-agent` receive a slim, token-efficient Overlord prompt while preserving reliable permissions and CLI lifecycle behavior.
