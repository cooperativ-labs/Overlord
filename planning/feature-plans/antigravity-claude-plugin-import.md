# Antigravity import of the Overlord Claude Code plugin — findings

Mission coo:1324, objective coo:1324.rkjf. Date: 2026-11-20.

**Contract impact: none.** This objective adds this planning document only. No adapter, manifest,
fixture or contract file changed.

## Recommendation

**Keep separate native adapters.** Do not generate the Antigravity package from the Claude package
by running `agy plugin import`, and do not build it as "Claude package plus an Antigravity hooks
overlay".

Both packages are already rendered from the shared Connector Core (`connectors/core`). They share
the `overlord-mission` skill, its references and the MCP shim. What is specific to each harness
is exactly what an import gets wrong: hooks, the MCP server mode, the agent identity, the manifest
and the command/skill names. An overlay would have to replace all of these, so it would rebuild
the native adapter by another route. It would also lose the fixture-backed conformance that the
native adapter has (`harness-capabilities.yaml`, codecs, `fixtures/`).

The duplication that remains is in the eight per-operation command or skill files. Each pair
differs in only 3–20 lines (harness name, `--agent` value, frontmatter, argument wording). That is
better fixed by rendering them from one core template (see "Follow-up" below) than by importing.

## What was run

| Step | Command | Environment |
| --- | --- | --- |
| Generate Claude plugin | `ovld agent-setup claude --home <scratch>` (repo CLI, `OVERLORD_CONNECTORS_DIR=connectors/adapters`) | Isolated scratch home. Produces connector 0.3.82 at `<scratch>/.ovld/claude/marketplace/plugins/overlord`, the same layout as `~/.ovld/claude/marketplace/plugins/overlord` |
| Import by path | `HOME=<scratch2> agy plugin import <plugin dir>` | Isolated HOME, so the user's real `~/.gemini` was not touched |
| Import by source | `HOME=<scratch> agy plugin import claude` | The same scratch home, where the Claude CLI had installed the plugin (`installed_plugins.json` v2) |
| Validate | `agy plugin validate <dir>` on the imported plugin, the Claude source and a scratch-rendered native adapter | — |

The user's own `~/.ovld/claude/...` copy was not used, because it is stale (August build, before
the `mcp_tool` hooks of coo:1323). A fresh render is what `ovld agent-setup claude` would install
today.

**Limitation: only agy 1.0.4 was available.** Updating `agy` (`agy update`, latest is 1.5.13) was
refused in this session as a change to the user's machine. agy 1.0.4 has no `--strict` or `--json`
on `validate`: it treats both as the plugin path (`Error: missing plugin.json: stat --strict
--json …`). **`agy plugin validate --strict --json` therefore could not be run.** Where a later agy
release changes import behaviour, the table below uses its release notes (`agy changelog`) and the
current docs (https://antigravity.google/docs/plugins/, `/docs/hooks/`, `/docs/build-plugins/`), and
marks those rows *inferred*.

## Results by component

Observed = from the agy 1.0.4 run. Inferred = from agy ≥1.4/1.5 release notes and the current docs,
not observed.

| Component | Claude plugin | After import (observed, 1.0.4) | Current agy (inferred) | Native adapter |
| --- | --- | --- | --- | --- |
| Manifest | `.claude-plugin/plugin.json` with version 0.3.82, description, author, keywords, `engines`, `userConfig` | `plugin.json` reduced to `{"name":"overlord"}`. Version, description, author and `userConfig` are dropped | Release notes describe no manifest conversion. `userConfig` has no Antigravity equivalent: the schema has `additionalProperties: false`, and the closest feature is per-MCP-server `variables` | Documented schema: `displayName`, `logo`, `suggestedPrompts`, version |
| Skills | `skills/overlord-mission/` + references | Copied unchanged (validator: 9 skills, counting converted commands) | Same | Same core-rendered skill, with Antigravity command names (`/attach`, not `/overlord:attach`) and `--agent antigravity` |
| Commands | 8 × `commands/*.md` | Converted to `skills/overlord-cmd-<name>/SKILL.md`. Frontmatter has no `name`, and Claude fields remain (`argument-hint`, `disable-model-invocation`, 9 × `$ARGUMENTS`, "this Claude Code session") | 1.5.5/1.5.10 name each skill after its folder (`overlord-cmd-*`) and accept Claude frontmatter values | 8 × `skills/<name>.md`, invoked as `/attach`, `/create`, … |
| Agent identity | `--agent claude` in `create`, `prompt`, `record-work` and the core skill (6 occurrences). MCP shim `DEFAULT_AGENT = 'claude'` | Carried over unchanged: **missions created or recorded from Antigravity would be attributed to Claude** | Same. Import does not rewrite skill text or scripts | `--agent antigravity`, `DEFAULT_AGENT = 'antigravity'` |
| MCP | `.mcp.json`: one server, `overlord-hooks`, `node ${CLAUDE_PLUGIN_ROOT}/scripts/overlord-mcp.mjs --hooks` | `mcp_config.json` copies the server **with `${CLAUDE_PLUGIN_ROOT}` unexpanded**, and **`scripts/overlord-mcp.mjs` is not copied**, so the server cannot start | 1.0.14 copies the whole plugin directory. 1.4.11 expands `${CLAUDE_PLUGIN_ROOT}`. The server would start, but in `--hooks` mode it **lists no tools**, so the model gets no Overlord MCP tools | `overlord` server running the model-facing tool set (`overlord_attach_session`, `overlord_deliver_session`, …) |
| Hooks | `hooks/hooks.json`, Claude shape (top-level `"hooks"`), events `UserPromptSubmit`, `PostToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`), `Stop`; every handler is `type: "mcp_tool"` with `${session_id}`-style snake_case input templates | Copied byte for byte to `hooks.json`. The validator reports **`hooks: skipped (not found)`**: Antigravity loads none of them | 1.5.5 converts `PreToolUse`, `PostToolUse`, `Stop` and startup `SessionStart`, maps matcher tool names (`Bash`→`run_command`) and lists unconvertible hooks as warnings. **`UserPromptSubmit` has no mapping**, so prompt capture is lost. The docs say only `type: "command"` is supported, so the `mcp_tool` handlers cannot run even when their event maps | `overlord` group with `enabled`, `PreInvocation` (prompt via `lastUserInput`), `PostToolUse` (`write_to_file\|replace_file_content\|multi_replace_file_content\|run_command`), `Stop` (`decision: "continue"`). Command hooks read camelCase stdin. Validator: `hooks: 3 processed` |
| Hook payloads | Claude input is snake_case (`session_id`, `tool_name`, `tool_input`, `stop_hook_active`) and is projected into MCP tool arguments by template | n/a (not loaded) | Antigravity sends camelCase JSON on stdin (`conversationId`, `toolCall.name/args`, `lastUserInput`, `fullyIdle`, and from 1.5.4 `hookEventName`/`cwd`/`toolCall.id`). No snake_case fields exist, so even converted handlers would read missing fields | Codec `codec/antigravity.codec.yaml` maps camelCase fields. Pinned by fixtures |
| Other files | `README.md`, `CAPABILITIES.md`, `harness-capabilities.yaml`, `prompt-wrapper.md`, `scripts/` | Dropped | Copied (1.0.14), but inert | Native equivalents, plus the generated `hooks/overlord-post-tool-use.sh` from core |
| Source-mode import | — | `agy plugin import claude` printed `No claude extensions found.` for a plugin installed through a local marketplace | 1.4.11 reads Claude Code's installed-plugins list | n/a |

### Validation

| Target | `agy plugin validate` (1.0.4) |
| --- | --- |
| Imported plugin | ok — skills 9, mcpServers 1, **hooks skipped (not found)** |
| Claude source directory | error — `missing plugin.json` (the manifest is under `.claude-plugin/`) |
| Native adapter (scratch render) | ok — skills 9, mcpServers 1, **hooks 3** |
| `--strict --json` on any target | not runnable on 1.0.4 (flags parsed as a path) |

From the release notes, a strict validator (≥1.4.3) would also flag the imported package for:
a Claude-style top-level `"hooks"` key (1.4.3), unknown hook events such as `UserPromptSubmit`
(1.4.3), unrecognised matcher tool names such as `Edit`, `Write`, `MultiEdit` and `NotebookEdit`
before conversion (1.4.4), and skills whose `SKILL.md` has no `name` (1.4.1). Under `--strict`,
those warnings fail validation. The release notes do not say whether a non-`command` handler type
is flagged.

## Why the overlay option still loses

"Generate the Antigravity package from the Claude one with an Antigravity hooks overlay" would mean
keeping the Claude skills, commands and MCP shim and swapping in an Antigravity `hooks.json` and
scripts. The test shows the overlay would also have to:

1. replace the MCP server: the Claude package ships only the tool-less `--hooks` server, so the
   overlay needs a model-facing server rendered with `DEFAULT_AGENT = 'antigravity'`;
2. rewrite skill text: `--agent claude`, `/overlord:*` command names, `$ARGUMENTS` and "Claude Code
   session" wording;
3. replace the manifest: `.claude-plugin/plugin.json` and `userConfig` do not fit Antigravity's
   closed schema;
4. supply its own codec, decision codec, fixtures and `harness-capabilities.yaml`, which are
   per-harness by contract.

Once all four are replaced, nothing Claude-specific is left to reuse. What is left is the shared
core, which both adapters already render from. The overlay would add a dependency on the Claude
package's layout and on `agy`'s import converter, which changed in at least five releases
(1.0.14, 1.4.11, 1.5.5, 1.5.6, 1.5.10). It would gain nothing that `connector-core-render` does not
already provide.

Users who run `agy plugin import claude` on a machine that has the Overlord Claude plugin will get a
second, degraded `overlord` plugin. It would fight with the native install for the same plugin
name, attribute work to Claude, and have no working hooks. Add a short note to the Antigravity
README telling users not to import the Claude plugin and to run `ovld agent-setup antigravity`
instead. `ovld doctor` could also detect an `import_manifest.json` entry for `overlord` with
`source: claude-code`. This is listed as deferred work rather than changed here, because it is a
user-facing behaviour change, not a fixture-backed trivial fix.

## Follow-up

- Render the eight per-operation command/skill files from one Connector Core template with
  harness placeholders (harness name, `--agent` value, slash-command prefix, argument wording).
  This removes the remaining Claude/Antigravity duplication without depending on `agy` import.
- Re-run this check, including `agy plugin validate --strict --json`, once agy ≥1.5.5 is installed,
  to confirm the *inferred* rows above (hook conversion warnings for `UserPromptSubmit` and
  `mcp_tool`).
