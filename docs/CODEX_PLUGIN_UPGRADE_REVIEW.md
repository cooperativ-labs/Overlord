# Codex Plugin Upgrade Review

Reviewed and updated on 2026-03-27 against the official OpenAI Codex plugin docs:
https://developers.openai.com/codex/plugins

## Implemented in this upgrade

The Overlord Codex plugin now aligns more closely with the current Codex plugin model described
in the docs:

- Plugin manifest at `plugins/overlord/.codex-plugin/plugin.json`
- MCP server manifest at `plugins/overlord/.mcp.json`
- Bundled skill at `plugins/overlord/skills/overlord-ticket-workflow/SKILL.md`
- Branded plugin assets under `plugins/overlord/assets/`
- Local marketplace registration via `~/.agents/plugins/marketplace.json`
- Personal install path `~/.codex/plugins/overlord` with marketplace `source.path` set to
  `./.codex/plugins/overlord`

That means the plugin now uses both the MCP-server and skill parts of the documented bundle
model, and its install path matches the personal-install example from the official docs.

## What changed

### 1. Bundled Codex workflow skill

The plugin docs describe plugins as a bundle that can include `skills`, `apps`, and
`mcpServers`. The plugin now ships a real `skills/` directory and points the manifest at it.

Implemented:

- Added `plugins/overlord/skills/overlord-ticket-workflow/SKILL.md`
- Added `"skills": "./skills/"` to the plugin manifest
- Kept the launched-ticket prompt authoritative, while moving reusable local workflow knowledge
  into the plugin bundle

Why it matters:

- Lets Codex discover Overlord workflows progressively instead of depending only on long
  per-ticket prompt text
- Makes the plugin closer to the intended plugin packaging model
- Reduces pressure on the launch prompt and improves reuse across sessions

### 2. Improved install-surface metadata and branding

The manifest now uses the richer `interface` metadata described in the docs.

Implemented:

- Added branded assets under `plugins/overlord/assets/`
- Added `brandColor`, `composerIcon`, `logo`, and `screenshots`
- Replaced repo-root legal links with public `ovld.ai` URLs

Why it matters:

- Improves presentation in Codex install surfaces and `/plugins`
- Makes the plugin look publish-ready if OpenAI opens self-serve directory publishing
- Removes weak metadata that previously pointed everything at the repo root

### 3. Moved the managed personal install location

The docs use `~/.codex/plugins/` as the personal install example. The installer and
desktop-managed service now copy the plugin to `~/.codex/plugins/overlord` and update the
personal marketplace entry to `./.codex/plugins/overlord`.

Why it matters:

- Better matches the examples in the official docs
- Lowers surprise for users debugging local plugin installs by hand

### 4. Remaining gap: app mapping

The docs now treat `apps` as a first-class plugin component. Overlord currently exposes only
chat tools plus a separate MCP app implementation in this repo.

What we found:

- Real local `.app.json` examples in this Codex install use a simple shape:
  `{ "apps": { "name": { "id": "asdk_app_..." } } }`
- Those IDs are OpenAI-issued app or connector identifiers
- This repo does not currently contain an issued Overlord app or connector ID to wire into a
  working `.app.json`

Recommended next step:

- When an Overlord app or connector is provisioned, add `.app.json` and point the manifest's
  `"apps"` field at it
- The existing `mcp-apps/ticket-card` app is the clearest first candidate for that mapping

Why it matters:

- It is the only remaining blocker to using all three documented plugin bundle components:
  `skills`, `apps`, and `mcpServers`
- Shipping a fake ID would create a broken install surface, so it is better left explicit and
  documented

## Current state

The plugin is now compatible with the documented local plugin model and follows the current
personal-install best practice. It bundles workflow knowledge as skills, ships richer
marketplace metadata, and uses the expected `~/.codex/plugins` path. The only documented plugin
surface not yet wired is `.app.json`, which requires a real OpenAI-issued app or connector ID.
