# coo:565 — Remove checkpoints from docs

Date: 2026-08-01

## Summary

Removed the product concept of **checkpoints** from documentation. Attach/deliver now document the VCS-baseline model only (`git status` at attach vs current tree at deliver). Connector core instructions no longer mention `refs/overlord/checkpoints`, `--skip-checkpoint`, or `ovld protocol revert` on checkpoints.

## Files touched (this mission)

### Public docs
- `docs/src/content/docs/context-and-artifacts.mdx` — dropped Checkpoints section; brief VCS-baseline note under change rationales
- `docs/src/content/docs/reviewing-work.mdx` — "File changes" section no longer anchors delivery to a checkpoint
- `docs/src/content/docs/glossary.mdx` — removed Checkpoint glossary entry
- `docs/src/content/docs/core-concepts.mdx` — Objective no longer lists checkpoint as payload
- `docs/src/content/docs/docs-for-agents/agent-protocol.mdx` — attach describes VCS baseline only; shared-worktree warning drops checkpoint revert
- `docs/src/content/docs/docs-for-agents/mission-launch-lifecycle.mdx` — attach step no longer mentions local checkpoint

### Connector / agent docs
- `connectors/core/overlord-mission/SKILL.md` — also removed the obsolete `ovld protocol revert` section
- `connectors/core/overlord-mission/reference/cli.md` — same
- `connectors/AGENTS.md` — capability-flag example no longer cites `supports-checkpointing`

### Internal module docs
- `cli/docs/11-review-artifacts-and-change-tracking.md`
- `webapp/docs/web-app.md`
- `webapp/docs/ui/06-current-changes.md`

### Version bump
- `connectors/VERSION` → `0.3.14` (and synced adapter plugin / MCP shim versions)

## Notes

- No code/API changes; docs-only cleanup aligned with existing CLI behavior (baseline at attach, delta at deliver).
- Repo-wide grep of `*.md` / `*.mdx` / `*.yaml` / `*.yml` finds no remaining `checkpoint` product references.
