# Overlord Surface Drift Report — Gemini → Antigravity Migration

## Summary

- Surfaces audited: API, CLI, MCP (hosted + Codex + Antigravity shims), agent plugins, docs/public, CLI README, launch commands
- Connector migration operations: aligned for `antigravity`
- Remaining `gemini` references: intentional (legacy cleanup, Antigravity path prefix `~/.gemini/`, feed/marketing unrelated to connector id)

## Verification Results (Phase 10)

| Check | Result |
|-------|--------|
| `agy plugin validate plugins/antigravity` | Pass (1 skill, 8 commands, 1 hook) |
| `ovld setup antigravity` | Installed plugin, patched MCP/hook paths, policy TOML |
| `ovld doctor antigravity` | `installed (v0.1.0)` |
| `ovld launch gemini …` | Exit 1 — agent must be one of: claude, codex, cursor, antigravity, opencode, pi |
| `ovld launch antigravity …` | Invokes `agy --add-dir … --prompt-interactive @<ctx>` (interactive; blocks in CI) |
| Desktop launch command | `agy --prompt-interactive @<ctx> --add-dir <tmpdir>` |
| Context URL (bundle installed) | `agent=antigravity&instructionMode=bundle` |
| Unit tests (migration suite) | 23 passed |
| Web/desktop type-check | Pass (after Phase 10 typing fixes) |

## Drift Findings

### Critical Drift

None for active connector surfaces. `gemini` is not in supported launch agents, protocol agent types, or user-facing docs for setup/launch.

### Parameter / Launch Drift

None material. Antigravity intentionally omits `--model` / `--thinking` on launch (managed inside Antigravity).

### Documentation Drift

- **Acceptable:** `docs/public/value-proposition.md` still names Gemini as a competitor runtime (not Overlord connector setup).
- **Acceptable:** `feed-page-functionality.md` describes Google Gemini API for feed generation (product feature, not CLI connector).
- **Acceptable:** `ai/feature-plans/antigravity-connector-migration.md` retains historical `ovld setup gemini` references as migration spec.

### Legacy / Migration-Only Code

- `slash-commands.ts` retains `gemini` agent branch for selective removal of managed `~/.gemini/commands/*.toml` during setup — not exposed in `getAllSlashCommandStatuses()`.
- `legacy-gemini-connector.cjs` + migration SQL + `sync-agent-models` delete `agent_type=gemini` rows.

### MCP / Plugin Parity

Antigravity local shim (`plugins/antigravity/scripts/overlord-mcp.mjs`) exposes `attach`, `update`, `deliver`, `record_work`, and related protocol tools matching CLI delegation pattern used by Codex shim.

## Recommendations

No blocking drift fixes required for migration delivery. Optional follow-up: rename `SlashCommandAgent` `gemini` branch to `legacy-gemini` for clarity in desktop slash-command module only.
