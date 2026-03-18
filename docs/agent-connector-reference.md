# Agent Connector Reference

This document lists what each Overlord agent connector installs — plugins, slash commands, and permission rules — and which files are created or modified. Overlord appends its additions to existing user config files where applicable and creates backups before modifying any file.

---

## Claude Code

### Plugins (Bundle)

| Item | File | Action |
|------|------|--------|
| Overlord workflow skill | `~/.claude/skills/overlord-local/SKILL.md` | Created |
| Permission hook script | `~/.claude/overlord-permission-hook.sh` | Created |
| Settings merge (hooks) | `~/.claude/settings.json` | Merged — adds `hooks.PermissionRequest` entry |

### Slash Commands

| Command | File | Format |
|---------|------|--------|
| `/connect <ticket-id>` | `~/.claude/commands/connect.md` | Markdown |
| `/load <ticket-id>` | `~/.claude/commands/load.md` | Markdown |
| `/spawn <objective>` | `~/.claude/commands/spawn.md` | Markdown |

### Permissions

| File | Changes |
|------|---------|
| `~/.claude/settings.json` (or `{projectDir}/.claude/settings.local.json`) | Adds to `permissions.allow`: `Bash(ovld protocol:*)`, `Bash(curl -sS -X POST:*)` |

### Manifest

| File | Purpose |
|------|---------|
| `~/.ovld/bundle-manifest.json` | Tracks bundle version, content hash, installation time, managed files |

---

## Codex

### Plugins (Bundle)

| Item | File | Action |
|------|------|--------|
| Workflow instructions | `~/.codex/AGENTS.md` | Appended — Overlord section inserted within managed markers (`<!-- OVERLORD:BEGIN -->` / `<!-- OVERLORD:END -->`) |

### Slash Commands

Codex does not support slash commands. Workflow instructions are embedded in `AGENTS.md` instead.

### Permissions

| File | Changes |
|------|---------|
| `~/.codex/rules/default.rules` | Appends two `prefix_rule()` blocks within managed markers: `npx overlord protocol` and `curl -sS -X POST` |

### Manifest

| File | Purpose |
|------|---------|
| `~/.ovld/bundle-manifest.json` | Tracks bundle version, content hash, installation time, managed files |

---

## Cursor

### Plugins (Bundle)

Cursor does not have a plugin/bundle system. Connector functionality is provided through slash commands and permissions.

### Slash Commands

| Command | File | Format |
|---------|------|--------|
| `/connect <ticket-id>` | `~/.cursor/commands/connect.md` | Markdown |
| `/load <ticket-id>` | `~/.cursor/commands/load.md` | Markdown |
| `/spawn <objective>` | `~/.cursor/commands/spawn.md` | Markdown |

### Permissions

| File | Changes |
|------|---------|
| `~/.cursor/settings.json` (or `{projectDir}/.cursor/settings.json`) | Adds to `permissions.allow`: `Shell(ovld protocol:*)`, `Shell(curl -sS -X POST:*)` |

---

## Gemini

### Plugins (Bundle)

Gemini does not have a plugin/bundle system. Connector functionality is provided through slash commands and permissions.

### Slash Commands

| Command | File | Format |
|---------|------|--------|
| `/connect <ticket-id>` | `~/.gemini/commands/connect.toml` | TOML |
| `/load <ticket-id>` | `~/.gemini/commands/load.toml` | TOML |
| `/spawn <objective>` | `~/.gemini/commands/spawn.toml` | TOML |

### Permissions

| File | Changes |
|------|---------|
| `~/.gemini/policies/overlord-protocol.toml` | Creates TOML with two `[[rule]]` blocks at priority 900 for `ovld protocol` and `curl -sS -X POST` |

---

## OpenCode

### Plugins (Bundle)

| Item | File | Action |
|------|------|--------|
| Workflow instructions | `~/.config/opencode/AGENTS.md` | Appended — Overlord section inserted within managed markers (`<!-- overlord:managed:start -->` / `<!-- overlord:managed:end -->`) |
| Config merge | `~/.config/opencode/opencode.json` | Merged — adds `instructions` entry and bash permission rules |

### Slash Commands

| Command | File | Format |
|---------|------|--------|
| `/connect <ticket-id>` | `~/.config/opencode/commands/connect.md` | Markdown |
| `/load <ticket-id>` | `~/.config/opencode/commands/load.md` | Markdown |
| `/spawn <objective>` | `~/.config/opencode/commands/spawn.md` | Markdown |

### Permissions

| File | Changes |
|------|---------|
| `~/.config/opencode/opencode.json` | Adds `permission.bash` allow rules for `ovld protocol *` and curl POST requests |

### Manifest

| File | Purpose |
|------|---------|
| `~/.ovld/bundle-manifest.json` | Tracks bundle version, content hash, installation time, managed files |

---

## Summary Table

| Agent | Plugins/Bundle | Slash Commands | Permissions | Config Files Modified |
|-------|---------------|----------------|-------------|-----------------------|
| Claude | Skill, hook, settings merge | /connect, /load, /spawn | settings.json allow rules | `~/.claude/skills/overlord-local/SKILL.md`, `~/.claude/overlord-permission-hook.sh`, `~/.claude/settings.json`, `~/.claude/commands/{connect,load,spawn}.md` |
| Codex | AGENTS.md instructions | None | default.rules prefix rules | `~/.codex/AGENTS.md`, `~/.codex/rules/default.rules` |
| Cursor | None | /connect, /load, /spawn | settings.json allow rules | `~/.cursor/commands/{connect,load,spawn}.md`, `~/.cursor/settings.json` |
| Gemini | None | /connect, /load, /spawn | TOML policy rules | `~/.gemini/commands/{connect,load,spawn}.toml`, `~/.gemini/policies/overlord-protocol.toml` |
| OpenCode | AGENTS.md instructions, opencode.json merge | /connect, /load, /spawn | opencode.json bash allow rules | `~/.config/opencode/AGENTS.md`, `~/.config/opencode/opencode.json`, `~/.config/opencode/commands/{connect,load,spawn}.md` |

---

## Notes

- **Non-destructive**: All connector installations create backups of existing files before modification.
- **Append-only**: Overlord appends its additions to existing config files (e.g., `settings.json`, `AGENTS.md`) rather than overwriting them. Managed sections are marked with `<!-- overlord:managed:start -->` / `<!-- overlord:managed:end -->` comments where applicable.
- **Repair**: If managed files are partially missing, connectors can be repaired (reinstalled) without affecting user-owned config.
- **Uninstall**: Only Overlord-owned files and managed sections are removed during uninstall; user config is preserved.
- **Bundle manifest**: Tracked in `~/.ovld/bundle-manifest.json` for version detection and stale/partial install identification.
