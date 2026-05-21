# Antigravity (`agy`) Plugin Schema — Phase 1 Findings

CLI used: `agy 1.0.0` at `/Users/jake/.local/bin/agy`. Throwaway plugins were created
under `/private/tmp/agy-plugin-probe/` and probed with `agy plugin validate <path>`
and `agy plugin install <path>` / `agy plugin import --force <path>`. Plugin removed
after capture; no install-state remains on disk.

## TL;DR

- Manifest filename: **`plugin.json`** at the plugin root. Only `name` is required.
- Top-level capability keys recognized by the validator: **`skills`, `agents`, `commands`, `mcpServers`, `hooks`**.
- Local install path is **`agy plugin install <path>`**, which is functionally identical to `agy plugin import <path>` for local bundles.
- Installed local bundles land in a **single shared directory `~/.gemini/antigravity-cli/plugins/`**, NOT per-plugin under `~/.gemini/config/plugins/`. The latter is reserved for marketplace plugins (`chrome-devtools-plugin`, `modern-web-guidance-plugin`, `google-antigravity-sdk`).
- `agy` exposes **no model / thinking-level flags**. Model selection is fully Antigravity-managed.

## Required manifest fields

`agy plugin validate` only rejects manifests missing `name`. Everything else
(`version`, `description`, `author`, etc.) is optional metadata. Example minimum:

```json
{ "name": "overlord" }
```

The full Overlord bundle should still mirror the Claude plugin's metadata
(`version`, `description`, `author`, `homepage`, `repository`, `license`,
`keywords`) for parity and human-readability.

## Capability schema

| Key          | Form in `plugin.json`                                      | Notes |
|--------------|------------------------------------------------------------|-------|
| `skills`     | string path to a skills dir; each subdir holds `SKILL.md` | Skill md is Anthropic-style frontmatter (`name`, `description`) + body. |
| `agents`     | string path to an agents dir                              | Not exercised; validator skipped quietly when absent. |
| `commands`   | string path to a commands dir                              | **Both `.md` and `.toml` accepted.** `.md` uses frontmatter + body; `.toml` uses `description = "…"` / `prompt = "…"`. |
| `mcpServers` | inline JSON object (`{ "<name>": { "command": …, "args": […] } }`) | Validator reports `skipped`, but **`agy plugin install` / `import --force` actually processes them** ("mcpServers : 1 processed"). Treat installer output as source of truth, not validator. A `mcpServers` value pointing at a file path is NOT recognized. |
| `hooks`      | string path to `hooks.json`                                | Same JSON schema as Claude Code (`hooks → <Event> → [{matcher, hooks: [{type, command}]}]`). |

### Commands are converted to skills on install

When you run `agy plugin install <path>`, every command file is rewritten into a
skill: `commands/bar.toml` (with `description = "bar command"` /
`prompt = "do bar"`) becomes `~/.gemini/antigravity-cli/plugins/skills/bar/SKILL.md`
with frontmatter `name: bar / description: bar command` and the prompt as body.

Implication: keep slash-command surface area minimal and write each command as if
it were a skill. Anything that relied on Claude-style command parameters needs to
survive the conversion to skill body text.

### Hook schema

`hooks.json` is byte-for-byte identical to the Claude Code shape:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": ".*", "hooks": [{ "type": "command", "command": "${PLUGIN_ROOT}/scripts/hook.sh" }] }
    ]
  }
}
```

Install copies the file verbatim to `~/.gemini/antigravity-cli/plugins/hooks.json`.
The `${PLUGIN_ROOT}` token is preserved literally — substitution (if any) happens
at runtime, not install time. **`${CLAUDE_PLUGIN_ROOT}` is not aliased**;
the actual env var name `agy` injects when firing the hook is unverified by
this experiment. Validator does not check event names or var substitution.

Open question for runtime: does `agy` actually fire `UserPromptSubmit` (or an
equivalent event) with stdin payload compatible with the current
`user-prompt-submit-hook.sh`? **Validator silence does not prove the event is
wired.** Implementation phase must confirm by running `agy` and tailing the
hook script.

### `mcpServers` — local script reference caveat

`agy plugin install` does NOT copy the surrounding `scripts/` directory into
`~/.gemini/antigravity-cli/plugins/`. So an `mcp_config.json` entry like
`{ "command": "node", "args": ["./scripts/overlord-mcp.mjs"] }` resolves to a
non-existent path post-install — the relative path is preserved verbatim, but
the file it points at was never staged.

Workable options for shipping `overlord-mcp.mjs`:

1. **npm bin** — publish/maintain a `overlord-mcp` executable on PATH, reference
   it by name in `args`.
2. **Absolute path injected at setup** — `ovld setup antigravity` writes the
   path into `mcp_config.json` post-install based on the resolved bundle root
   (similar to how the Claude plugin sets `${CLAUDE_PLUGIN_ROOT}`).
3. **Confirm whether `agy` substitutes a `${PLUGIN_ROOT}` style token in
   `mcp_config.json` at runtime** — if it does, ship the script alongside and
   reference it the same way. The probe didn't observe substitution, but I
   didn't actually fire an MCP call.

Recommend (2) for the first implementation slice — keeps the bundle
self-contained and matches existing setup-time behavior.

## Installed-path resolution

Two distinct locations exist, with different roles:

| Path                                       | Used for                                         |
|--------------------------------------------|--------------------------------------------------|
| `~/.gemini/config/plugins/<plugin-name>/`  | Marketplace plugins installed via `<name>@<marketplace>`. Each plugin gets its own directory. `plugin.json` is preserved as-is. |
| `~/.gemini/antigravity-cli/plugins/`       | A **single merged directory** for everything imported from local paths or `agy plugin import gemini`/`claude`. All skills, commands-converted-to-skills, `hooks.json`, and `mcp_config.json` are flattened into this one place. |

Implications for the Overlord connector:

- Local-path install collides with anything else previously imported into
  `~/.gemini/antigravity-cli/plugins/`. The probe ran with an empty
  `antigravity-cli/` and saw the staged tree replace it. Production setup
  should `agy plugin uninstall overlord` (or scrub) first, or accept that
  Overlord becomes the sole local-imported plugin.
- The plugin's `name` field was recorded as an **empty string** in
  `import_manifest.json` after `agy plugin install <local-path>` — i.e., agy
  does not currently use `plugin.json.name` to namespace local imports. This
  blocks reliable `agy plugin uninstall <name>` UX. Worth confirming whether
  marketplace installs behave differently; if not, doctor/uninstall logic must
  detect by file presence, not by plugin name.
- Use `agy plugin list` to inspect import state; it returns JSON
  (`imports[].source`, `components`, `importedAt`).

## Install command

- Local-path install is **`agy plugin install <path>`**. No need to shell to
  any other command — `install`, `import`, and the marketplace form
  (`<name>@<marketplace>`) all live under the same `agy plugin` subcommand.
- `agy plugin install` and `agy plugin import` produce identical results for
  local bundles. `install` re-imports without `--force`; `import` requires
  `--force` if already imported.
- Setup should call `agy plugin install <bundle-path>` (matching Claude/Cursor
  setup patterns). No extra `gemini` CLI shell-out is needed.

## Model selection

```
$ agy --help | grep -iE 'model|thinking|temperature'
(empty)
```

`agy` exposes no `--model`, `--thinking-level`, `--temperature`, or
`--reasoning` flag. Subcommands (`changelog`, `install`, `plugin`, `update`)
likewise have no model flags. **Treat model selection as Antigravity-managed**
and drop launch-time model/thinking parity from the Antigravity connector.
This matches the migration plan's existing recommendation.

## Validator divergence to be aware of

`agy plugin validate <path>` and `agy plugin install <path>` disagree on
`mcpServers` (and apparently command count — install dedupes `bar.md` /
`bar.toml` to one skill, validate reports both as processed). When wiring
the Overlord doctor / CI checks, **run `agy plugin install` against a
staged copy** and parse its output for "N processed" lines instead of
relying on `validate`. Or run both and treat any "✔ … processed" as
success-by-either.

## Recommended implementation defaults

1. Manifest at `plugins/antigravity/plugin.json` with the same metadata block
   as `plugins/claude/.claude-plugin/plugin.json`, minus `userConfig`/`hooks`
   shape adjustments shown below.
2. Commands as either `.md` (Markdown body) or `.toml` (`description`/`prompt`).
   Pick `.toml` for parity with the existing `~/.gemini/commands/*.toml`
   surface; both work.
3. `hooks/hooks.json` with `UserPromptSubmit` + `PermissionRequest` matchers
   pointing at `${PLUGIN_ROOT}/scripts/*.sh` (with a runtime fallback if
   `${PLUGIN_ROOT}` turns out to be unsupported — confirm during Phase 5
   launch verification).
4. `mcpServers` declared inline in `plugin.json`, with `overlord-mcp.mjs`
   path injected as absolute path by `ovld setup antigravity` at install time.
5. Skip `agents`. Skills directory only carries the `overlord-ticket` skill,
   mirroring Claude/Cursor parity.
6. Drop `--model` / `--thinking-level` from the launch command in
   `apps/desktop/electron/services/agent-launcher.ts`.
