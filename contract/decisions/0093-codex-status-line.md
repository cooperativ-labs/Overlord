# ADR 0093: Codex status line through an MCP statusline provider

Date: 2026-11-20
Status: accepted
Contract version: [179.9.0](../CHANGELOG.md#17990---2026-11-20)
Supersedes: none (extends contract v179.3 `ovld status-line` and the native-session index of ADR 0088)
Contract impact: minor

## Context

Contract v179.3 added `ovld status-line` and the Claude `terminal.statusSurface`. Codex had no
status surface. Codex 0.171 added custom TUI footers from MCP servers, behind the experimental
feature `tui_extensions_statusline` (off by default). Verified in the 0.171.0 source and live
(coo:1325.fx4f, fixtures under `connectors/adapters/codex/fixtures/status-line-*.json`):

- A provider is an MCP tool whose `_meta["openai/ui"].entrypoints` names exactly one
  `{ type: "statusline", resourceUri: "ui://…" }`. Codex reads that URI with `resources/read`,
  passing the displayed thread's state in `params._meta["com.openai/codex-statusline-state"]`
  (thread id, model, workspace cwd, context usage, …). It returns a JSON UI tree, or `null`.
- Codex allows each read one second, waits one second between successful reads, and stops polling
  after an error or timeout until the person reselects the provider. A selected provider replaces
  the built-in footer.
- The selection is `tui.status_line_provider = { server, tool }` and is honoured only from user,
  system or session layers, never from project config. A plugin's MCP server is named by its
  `.mcp.json` key (`overlord`).
- In 0.171 the TUI talks to a shared app-server daemon under `CODEX_HOME` that outlives the TUI and
  runs plugin MCP servers. An Overlord-driven session runs them inside its private app server,
  whose environment is allowlisted and carries no launch binding.
- Codex shell tools see `CODEX_SESSION_ID` (the root session, which hooks send as `session_id`) and
  `CODEX_THREAD_ID`; in a root thread both equal the thread id.

## Decision

1. **The Codex rendering of the local MCP shim is the provider.** Only the `codex` rendering of
   `connectors/core/scripts/overlord-mcp.mjs` (not `--hooks` mode) declares the `resources`
   capability, lists the tool `overlord_status_line` (title "Overlord mission") with the
   `statusline` entrypoint `ui://overlord/status-line`, and answers `resources/list`,
   `resources/templates/list` and `resources/read` for that URI. Calling the tool only returns a
   description. Other adapters' renderings are unchanged.
2. **A read never fails or waits.** Each read renders the built-in items it replaces (model and
   effort, folder, context left) from the state Codex sent, then the Overlord segment. The segment
   comes from `ovld status-line --agent codex --ui-tree --native-session-id <thread id>`, cached
   per thread for 10 s, with one command in flight per thread. A read waits at most 500 ms for a
   stale segment, then answers with the previous one. A slow, missing or failing `ovld`, or
   malformed state, never turns into an error response.
3. **`ovld status-line --ui-tree`** prints the same segment as the text line as a Codex UI tree:
   a `row` of `ovld`, the mission display id and title, `›`, the objective key and title, and the
   state, or `null` when unbound. Titles are cut to 32 and 48 characters. The payload reader also
   accepts Codex's `thread.id` and `thread.workspace.cwd`. Binding rules are unchanged: the
   native-session index, else the launch environment, never the working directory.
4. **Codex threads are indexed.** `attach`, `connect` and `resume-follow-up` run by a Codex agent
   index `CODEX_SESSION_ID` (or `CODEX_THREAD_ID`) under the `codex` agent when the harness exports
   no Claude session id, exactly as `CLAUDE_CODE_SESSION_ID` is indexed. The root session id is
   both the hooks' `session_id` and a root thread's status-line `thread.id`. The
   `codex-app-server` sidecar indexes its thread under `codex` when the thread is ready and removes
   the entry on exit, only while it still names the session's objective, because its provider runs
   without a launch binding. The index is still a lookup alias, never a grant, and never feeds file
   capture.
5. **Opt-in setup.** `ovld agent-setup codex --status-line` (or a yes at its interactive prompt,
   offered only on Codex 0.171+ with no provider selected) edits `~/.codex/config.toml`: it sets
   `features.tui_extensions_statusline = true` only when unset, and selects the Overlord provider
   only when no provider is selected. An explicit `false` or another selection (including
   `"default"`) is kept and reported. The merged text is re-parsed, and a layout the merge cannot
   edit safely is left untouched with manual instructions. On older Codex the selection is still
   written and setup says it needs 0.171.

## Consequences

- `terminal.statusSurface` is `supported` for `codex` and `codex-app-server`, with recorded
  0.171.0 state, an executable `script-io` fixture of the provider, and source guards.
- The hooks adapter now finds index entries for attached, user-started Codex sessions, as the
  Claude adapter already did. A thread viewed as a child (subagent) in the TUI is not indexed and
  shows only the built-in items.
- Because the daemon outlives the TUI, the launch-environment fallback is only reliable for the
  session that started it; the index is the binding that holds across sessions.
- Each Codex TUI with the provider selected starts one short `ovld status-line` process about every
  10 s per displayed thread.
- The feature is experimental in Codex and may change; the provider speaks only the documented
  entrypoint, resource and UI-tree shapes, and Codex falls back to its built-in footer when a
  provider is invalid.
