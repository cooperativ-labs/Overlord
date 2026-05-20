# Overlord Plugin for Antigravity CLI

This plugin wires the [Overlord](https://www.ovld.ai) ticket protocol into the
[Antigravity CLI](https://antigravity.dev) (`agy`). It provides:

- **Skill** — `skills/overlord-ticket/SKILL.md` loaded automatically by `agy` for every session.
- **Commands** — slash commands for common ticket operations (`/overlord:connect`,
  `/overlord:load`, `/overlord:attach`, `/overlord:discuss-objective`, `/overlord:create`,
  `/overlord:prompt`, `/overlord:record-work`, `/overlord:add-objectives`).
- **Hook** — `hooks/hooks.json` with a `UserPromptSubmit` listener that forwards user turns to
  Overlord in the background.
- **MCP server** — `scripts/overlord-mcp.mjs` exposes the full `ovld protocol` surface as MCP
  tools so `agy` can call Overlord natively without shelling out.

## Installation

```bash
ovld setup antigravity
```

`ovld setup antigravity` installs this bundle into `~/.gemini/antigravity-cli/plugins/` via
`agy plugin install` and then rewrites the MCP server `args` path in the installed config to an
absolute path — because `agy plugin install` does **not** copy the surrounding `scripts/`
directory, a relative path would break.

## Hook token substitution

`hooks/hooks.json` references `${PLUGIN_ROOT}/scripts/user-prompt-submit-hook.sh`. Whether `agy`
substitutes `${PLUGIN_ROOT}` at runtime is **not yet confirmed** — Phase 5 launch verification
must run `agy` with the installed bundle and confirm the hook fires. If substitution does not work,
`ovld setup antigravity` should overwrite the installed `hooks.json` with an absolute path.

## MCP path injection

`plugin.json` ships with `"args": ["__OVERLORD_MCP_SCRIPT_PATH__"]` as a placeholder.
`ovld setup antigravity` replaces this token with the absolute path to `overlord-mcp.mjs`
after install (written to `~/.gemini/antigravity-cli/plugins/mcp_config.json` or equivalent).

## Environment variables

| Variable               | Source               | Purpose                                      |
|------------------------|----------------------|----------------------------------------------|
| `OVERLORD_URL`         | Overlord launcher    | Base URL for API calls (e.g. https://ovld.ai)|
| `OVERLORD_ACCESS_TOKEN`| Overlord launcher    | Bearer token for API authentication          |
| `TICKET_ID`            | Overlord launcher    | Active ticket ID for hook routing            |
| `OVERLORD_LOCAL_SECRET`| Overlord launcher    | Optional local HMAC secret                   |

These are set automatically when `agy` is launched by Overlord Desktop or `ovld launch antigravity`.

## Upgrading

Run `ovld setup antigravity` again to reinstall the bundle at the latest version.
Check `plugin.json` → `version` for the current bundle version.
