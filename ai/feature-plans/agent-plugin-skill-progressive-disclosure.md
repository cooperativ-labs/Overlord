# Agent Plugin SKILL.md — Progressive Disclosure + Templated Source

Mapped the install pipeline before drafting. Key facts that shape the plan:

- `/plugins/` is the dev source-of-truth; `/packages/overlord-cli/plugins/` is the published copy. They drift manually today — no sync script.
- `ovld setup` (`packages/overlord-cli/bin/_cli/setup.mjs:915–1092`) does a verbatim `fs.cpSync` from the source plugin dir into `~/.claude/`, `~/.codex/plugins/overlord/`, `~/.cursor/plugins/local/overlord/`. **No templating today.**
- Per-agent variation points are small and well-bounded: agent display name, `--agent` flag, slash-command prefix (`/overlord:` vs `/` vs none for codex), hook name (`UserPromptSubmit` vs Cursor `beforeSubmitPrompt` vs none), and a handful of agent-only paragraphs (Claude permission-request hook, Codex MCP defaults).

# Plan: progressive disclosure + templated source

## 1. Goals (in priority order)

1. **Instruction adherence:** every `always / never / do not` rule stays in eager-loaded `SKILL.md`. Workflow decision points (Mode 1 vs 2, submit vs execute, create vs prompt vs record-work) stay in `SKILL.md`.
2. **Context concision:** trim each `SKILL.md` from ~250 lines to ~100–120 lines by moving worked examples and per-command flag prose into `reference/*.md` siblings, loaded only when the model is about to invoke a specific command.
3. **Single source of truth:** one templated source for the three agent plugins; a render step produces both the dev tree and the published tree. Drift becomes impossible (CI check).

## 2. SKILL.md split

**Stays in `SKILL.md` (rules-first, eagerly loaded):**

- Frontmatter + one-paragraph trigger description
- Mode 1 / Mode 2 decision tree with the 7-step happy path
- "Objective Submission vs Execution" (high-rule-density: discuss vs attach)
- "Recording Completed Work From Chat" — *the rule* (when to use `record-work` vs `create` vs `prompt` vs `deliver`), one bash snippet, link to reference for the full payload shape
- "Change Rationales" — *the requirement* (always include on deliver; record only behavioral changes; never send `file_changes` as an artifact)
- "Rules" block (all `always / never / do not` invariants, including the shell-escaping rule and the auth-repair rule)
- Pointer block: `For full flag reference see reference/cli.md` etc.
- Per-agent slash-command names (1 line per command)

**Moves to `reference/`:**

| File | Content |
|------|---------|
| `reference/cli.md` | Full prose + bash for each protocol subcommand (attach, update, ask, deliver, create, prompt, load-context, connect, search-tickets, discuss-objective, record-work, record-change-rationales, revert, discover-project). Phase enum, event types. |
| `reference/mcp.md` | MCP `<verb>_<noun>` naming, camelCase vs snake_case, hosted `/functions/v1/mcp` vs local shim, `agentIdentifier`/`connectionMethod` defaults. |
| `reference/devices.md` | Device-fingerprint rows, `get-device`, `list-project-resources`, `add-project-resource`, `update-device`, `--execution-target agent` vs `human`. |
| `reference/context.md` | `read-context`/`write-context`, attachment commands, "large artifacts → save to repo, summarize in delivery" policy. |
| `reference/shell-escaping.md` | `--summary-file -`, single-quoted heredocs, when to use `--payload-file` vs `--payload-json`. |

## 3. Templating model

Custom three-construct renderer (no Mustache/Handlebars dependency):

- `${name}` — variable substitution from the agent's config JSON
- `${{if:flag}}…${{endif}}` — conditional sections (e.g., slash commands, hooks)
- `${{include:path/to/partial.md}}` — file include (e.g., shared `reference/cli.md` body)

Per-agent config under `plugins/_source/agents/<agent>.json`:

```json
{
  "id": "claude",
  "name": "Claude Code",
  "flag": "claude-code",
  "slashPrefix": "/overlord:",
  "hasSlashCommands": true,
  "hook": "UserPromptSubmit",
  "hasHook": true,
  "installDir": ".claude"
}
```

References (`reference/*.md`) are mostly agent-agnostic — they describe `ovld protocol …`. They get pulled in via `${{include:…}}` so each plugin gets its own rendered copy (no symlinks; keeps the on-disk install simple).

Agent-specific overlay paragraphs (Claude permission-request hook; Codex MCP defaults) live as small files under `plugins/_source/agents/<agent>/overlays/*.md` and are pulled in via the same `${{include}}` from inside an `${{if:agentIs:claude}}` block — or, simpler, just keep one well-defined include slot per overlay (e.g., `${{include:agents/${id}/extra-notes.md}}` with a default empty file).

## 4. Target end-state filetree

```
/home/user/Overlord/
├── plugins/
│   ├── _source/                                   # NEW — single source of truth
│   │   ├── skills/
│   │   │   └── overlord-ticket/
│   │   │       ├── SKILL.md.tmpl                  # slim: rules + decision trees (~110 lines)
│   │   │       └── reference/
│   │   │           ├── cli.md.tmpl
│   │   │           ├── mcp.md.tmpl
│   │   │           ├── devices.md.tmpl
│   │   │           ├── context.md.tmpl
│   │   │           └── shell-escaping.md.tmpl
│   │   ├── commands/                              # slash-command templates (claude/cursor only)
│   │   │   ├── attach.md.tmpl
│   │   │   ├── connect.md.tmpl
│   │   │   ├── create.md.tmpl
│   │   │   ├── load.md.tmpl
│   │   │   ├── prompt.md.tmpl
│   │   │   ├── record-work.md.tmpl
│   │   │   └── spawn.md.tmpl
│   │   ├── hooks/                                 # hook config templates
│   │   ├── scripts/                               # shared scripts (overlord-mcp.mjs etc.)
│   │   ├── README.md.tmpl
│   │   └── agents/
│   │       ├── claude.json
│   │       ├── claude/
│   │       │   └── overlays/extra-notes.md        # claude-only paragraphs
│   │       ├── cursor.json
│   │       ├── cursor/
│   │       │   └── overlays/extra-notes.md
│   │       ├── overlord.json                      # (codex)
│   │       └── overlord/
│   │           └── overlays/extra-notes.md
│   │
│   ├── claude/                                    # GENERATED (committed)
│   │   ├── skills/overlord-ticket/
│   │   │   ├── SKILL.md
│   │   │   └── reference/{cli,mcp,devices,context,shell-escaping}.md
│   │   ├── commands/
│   │   ├── hooks/
│   │   ├── scripts/
│   │   └── README.md
│   ├── cursor/                                    # GENERATED (committed)
│   └── overlord/                                  # GENERATED (committed, codex)
│
├── packages/overlord-cli/
│   ├── plugins/                                   # GENERATED (committed, identical to /plugins/{agent}/)
│   │   ├── claude/
│   │   ├── cursor/
│   │   └── overlord/
│   ├── bin/
│   │   ├── _cli/setup.mjs                         # unchanged: verbatim cp
│   │   └── _dev/render-plugins.mjs                # NEW: _source → /plugins/* and packages/overlord-cli/plugins/*
│   └── package.json                               # add "prepack": "node bin/_dev/render-plugins.mjs --check-or-render"
└── …
```

## 5. Data flow diagram

```
                       ┌──────────────────────────────────────┐
                       │  plugins/_source/                    │
                       │  ├── *.tmpl   (shared content)       │
                       │  └── agents/<id>.json   (variables)  │
                       │       + agents/<id>/overlays/*.md    │
                       └──────────────┬───────────────────────┘
                                      │
                       yarn render-plugins  /  prepack hook
                       (packages/overlord-cli/bin/_dev/render-plugins.mjs)
                                      │
                ┌─────────────────────┼─────────────────────┐
                ▼                                           ▼
   /plugins/{claude,cursor,overlord}/        /packages/overlord-cli/plugins/{claude,cursor,overlord}/
      • used by ovld setup in repo dev          • shipped in the published tarball
      • committed for reviewer diffs            • committed; CI asserts byte-identity with /plugins/
                                      │
                       ovld setup <agent>  (fs.cpSync)
                                      │
                                      ▼
                  ~/.claude/        ~/.cursor/plugins/local/overlord/        ~/.codex/plugins/overlord/
                  └─ SKILL.md (rules)                  ←─ model loads this eagerly
                  └─ reference/*.md                    ←─ model fetches on demand
```

## 6. Render script behavior (`bin/_dev/render-plugins.mjs`)

1. Read `plugins/_source/agents/*.json` to enumerate agents.
2. For each agent, walk `plugins/_source/`, for every `*.tmpl`:
   - Apply variable substitution, conditionals, includes.
   - Strip `.tmpl` suffix.
   - Write to both `/plugins/<agent>/<relpath>` and `/packages/overlord-cli/plugins/<agent>/<relpath>`.
3. Copy non-template files (scripts, binary assets) verbatim to both trees.
4. Modes: `--render` (default, write), `--check` (CI: render to memory, exit nonzero if any output differs from on-disk).

Wire `yarn render-plugins` and `yarn check-plugins` at repo root. Add `"prepack": "node bin/_dev/render-plugins.mjs --render"` to `packages/overlord-cli/package.json` so npm publish never ships stale files.

## 7. Phased migration

1. **Phase 0 — Baseline.** Run a one-shot reconciliation: pick `/plugins/` as canonical, copy it over `/packages/overlord-cli/plugins/`, commit. Now both trees are byte-identical.
2. **Phase 1 — Introduce renderer.** Add `bin/_dev/render-plugins.mjs` and `plugins/_source/` containing templates that *reproduce the current /plugins/ output byte-for-byte*. Run `--check` in CI. No semantic changes yet — this proves the renderer is correct.
3. **Phase 2 — Split SKILL.md.** Edit `_source/skills/overlord-ticket/SKILL.md.tmpl` to slim form; create `_source/skills/overlord-ticket/reference/*.md.tmpl`. Re-render. The diff on `/plugins/<agent>/skills/overlord-ticket/` is reviewable per-agent.
4. **Phase 3 — Consolidate slash command and hook templates.** Same templating treatment for `commands/*.md` and the cursor-vs-claude hook configs.
5. **Phase 4 — Delete dead duplication.** Once renderer is stable, optionally `.gitignore` `/packages/overlord-cli/plugins/` and rely on `prepack` (or keep it committed for review visibility — slight preference for the latter).

## 8. Verification

- CI job: `yarn check-plugins` (renderer in check mode) — fails the build on drift.
- Manual smoke per agent: `ovld setup claude` into a scratch HOME, open the generated `SKILL.md` and one `reference/cli.md`, confirm headings + agent identity render correctly.
- Behavioral check: open a fresh Claude/Cursor/Codex session, give it a ticket; confirm it still attaches, updates, delivers, and includes `changeRationales`. The whole point of keeping rules in `SKILL.md` is that none of these should regress.

## Open questions before starting

- **Codex slash commands:** confirm Codex has *no* slash-command surface, so `_source/commands/` is gated `${{if:hasSlashCommands}}` and skipped entirely for the `overlord` agent.
- **Cursor hook name:** Explore reports a `beforeSubmitPrompt` hook for Cursor — current `SKILL.md` only mentions `UserPromptSubmit`. Treat the hook name as a variable and update the prose, or leave Cursor saying `UserPromptSubmit` until we confirm?
- **Where templates live:** `plugins/_source/` or `packages/overlord-cli/templates/`? Chose the former because it sits next to the rendered outputs and makes the relationship obvious in `git log` — flip if we'd rather keep `plugins/` agent-only.
