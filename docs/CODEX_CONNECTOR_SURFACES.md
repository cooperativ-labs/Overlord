# Codex Connector Surfaces

This document is the parity checklist for every place Overlord integrates with Codex.

Use it before shipping any Codex-related change. If one surface changes, check the others.

## Canonical model

- Local Codex uses the home-local Overlord chat plugin.
- Cloud or headless Codex uses the public MCP endpoint at `/api/mcp` with `AGENT_TOKEN`.
- Local Codex no longer uses an Overlord-managed `~/.codex/AGENTS.md` bundle.

## Surface checklist

### 1. Local installer and migration

- Desktop-managed plugin installer:
  [overlord-plugin.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/overlord-plugin.ts)
- Settings UI for local Codex install / repair / uninstall:
  [CliPage.tsx](/Users/jake/Development/Cooperativ/Overlord/components/modals/settings/CliPage.tsx)
- IPC exposure:
  [app.ts](/Users/jake/Development/Cooperativ/Overlord/electron/ipc/app.ts)
  [preload.ts](/Users/jake/Development/Cooperativ/Overlord/electron/preload.ts)
  [electron.d.ts](/Users/jake/Development/Cooperativ/Overlord/types/electron.d.ts)

Checklist:
- Plugin install writes `~/.agents/plugins/marketplace.json`
- Plugin install writes `~/plugins/overlord`
- Plugin install manages `~/.codex/rules/default.rules`
- Plugin install removes any legacy Overlord-managed Codex `AGENTS.md` section
- Plugin install removes any legacy Codex bundle manifest entry

### 2. Local launch path

- Electron launch service:
  [agent-launcher.ts](/Users/jake/Development/Cooperativ/Overlord/electron/services/agent-launcher.ts)
- Context route:
  [route.ts](/Users/jake/Development/Cooperativ/Overlord/app/api/protocol/context/[ticketId]/route.ts)
- Prompt builder:
  [ticket-prompt.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/ticket-prompt.ts)
- Capability resolver:
  [agent-capabilities.ts](/Users/jake/Development/Cooperativ/Overlord/lib/overlord/agent-capabilities.ts)

Checklist:
- Local Codex launches pass `agent=codex` into the context route
- Local Codex does not request `bundle` instruction mode
- Prompt text explicitly includes the Codex ticket workflow instructions
- Prompt text does not tell Codex to look for `overlord-local` or a local Codex bundle
- Prompt text may mention the plugin as optional tooling, but `ovld protocol` remains authoritative for launched ticket sessions

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
- Codex cloud instructions use `AGENT_TOKEN`
- Codex cloud guidance is clearly separated from the local plugin path

### 4. Onboarding flows

- Agent setup copy:
  [AgentSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/AgentSetupStep.tsx)
- Connector install flow:
  [ConnectorSetupStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConnectorSetupStep.tsx)
- Bundle install step:
  [InstallAgentBundlesStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/InstallAgentBundlesStep.tsx)
- Permission step:
  [ConfigureAgentPermissionsStep.tsx](/Users/jake/Development/Cooperativ/Overlord/components/features/onboarding/steps/ConfigureAgentPermissionsStep.tsx)

Checklist:
- Onboarding does not tell users to run `ovld setup codex`
- Codex onboarding points users to the local chat plugin install path
- Codex is not presented as a bundle-backed agent
- Codex permission setup is represented as part of plugin installation, not a separate bundle step

### 5. CLI legacy compatibility

- Setup command:
  [setup.mjs](/Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/setup.mjs)

Checklist:
- `ovld setup codex` is deprecated and does not install legacy bundle files
- Help text does not advertise Codex as a bundle-supported setup target

### 6. Demo / product copy

- Demo settings page:
  [DemoSettings.tsx](/Users/jake/Development/Cooperativ/Overlord/app/demo/DemoSettings.tsx)

Checklist:
- Demo copy describes the Codex chat plugin, not a prompt/skills bundle
- Demo managed-file list matches the real installer outputs

## Regression checks

When changing Codex integration, verify:

- Local Codex install status in Settings reflects plugin files and `default.rules`
- Installing the plugin cleans up legacy Codex bundle remnants
- Launching Codex from Overlord produces Codex-specific workflow instructions in the prompt
- Codex cloud instructions still produce a valid MCP config snippet
- No user-facing page advertises `ovld setup codex` or `~/.codex/AGENTS.md` as the current local Codex path
