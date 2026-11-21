# ADR 0087: Claude hooks call local MCP hook tools

Date: 2026-11-20
Status: accepted
Contract version: [179.2.0](../CHANGELOG.md#17920---2026-11-20)
Supersedes: none
Contract impact: minor

## Context

The Claude Code plugin's hooks were bash and python scripts. The Stop and permission scripts
were inert, every script read a cwd-keyed temp file that nothing wrote, and the Claude decision
codec emitted a `decision` string that Claude's PermissionRequest schema rejects. Claude Code
2.1.328 added `onFailure: "block"` for `mcp_tool` hooks, and Overlord requires that version, so
the hooks can call MCP tools instead of scripts. The plan is
`planning/feature-plans/claude-mcp-tool-hooks.md`.

## Decision

1. **Local hooks server.** The hook target is the connector shim
   (`connectors/core/scripts/overlord-mcp.mjs`) started with `--hooks`, bundled by the Claude
   plugin as a stdio server. Hosted MCP cannot be the target: capture writes a machine-local
   ledger, agent-session routes take only the channel credential, and the binding lives in the
   launch environment.
2. **No logic in hook tools.** `overlord_hook_user_prompt_submit`, `overlord_hook_post_tool_use`,
   `overlord_hook_stop` and `overlord_hook_permission_request` gate, rebuild the native payload
   from the templated hook input, spawn one fixed command (`ovld protocol hook-event`,
   `ovld protocol capture-change`, `ovld agent-session inbox|request`) with the payload on stdin,
   and answer with exactly one JSON object. The CLI is the one implementation and the supported
   fallback, so the MCP and CLI paths cannot drift. Parity tests drive both.
3. **Hidden from the model.** Hooks mode lists no tools. Claude Code 2.1.329 calls unlisted tools
   from hooks. The tools are connector-owned, not part of the hosted MCP catalog.
4. **Native hook mode.** `ovld protocol hook-event --agent <key> --payload-file -` decodes the
   payload with the connector codec and prints `hookOutput`. `--hook-type Stop` returns read-only
   `deliveryStatus`; the reminder blocks the stop at most once per session and objective and
   never when `stop_hook_active` is set. An injected channel instruction takes precedence.
5. **Binding.** The launch environment, else a native-session index keyed by
   `sha256(agent \0 native session id)` that attach, connect and resume-follow-up write and
   delivery removes. It holds no secret and never feeds file capture. The working directory
   never selects a binding.
6. **Fail-closed decisions only where launched.** A connector may register a decision hook with
   harness-level fail-closed behavior only for sessions it launched and bound. A failure to reach
   the local hook tool then denies. The core still returns no decision for every internal
   failure, so no failure can approve.

## Consequences

Codex, Cursor, Pi and Antigravity keep their shell hooks and the same CLI commands. A plugin MCP
server process starts in every Claude session; it does nothing before its per-call gate. Unlisted
hook tools rely on undocumented Claude Code behavior, so the Claude descriptor carries a hazard
and the probe is repeated whenever the verified version moves. Switching the plugin's
`hooks.json` and removing the scripts is separate connector work.

## Alternatives considered

Command hooks next to `mcp_tool` hooks would run both on every event, because matching hooks run
in parallel. Listing the hook tools with a "do not call" description, or denying them through
permission rules, exposes them to the model or depends on settings a plugin cannot own.
Treating a harness-side timeout of the decision hook as "no decision" is not possible with
`onFailure: "block"`; registering it only for launched sessions confines that consequence.
