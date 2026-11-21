# ADR 0090: Antigravity lifecycle hooks through the shared protocol hook path

Date: 2026-11-20
Status: accepted
Contract version: [179.5.0](../CHANGELOG.md#17950---2026-11-20)
Supersedes: none
Contract impact: minor

## Context

The Antigravity connector shipped skills and MCP only, so it was at capability tier 0. Antigravity
now documents command hooks (https://antigravity.google/docs/hooks): `SessionStart`,
`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation` and `Stop`, configured in a
plugin's `hooks.json`, with camelCase JSON on stdin and a JSON object on stdout. Plugin hooks run
with the plugin folder as their working directory. A failing hook (non-zero exit, timeout,
invalid JSON) is logged and ignored. The agy release notes add `hookEventName`, `cwd` and
`toolCall.id` to hook input in 1.5.4, and `continuation_active` to Stop input in 1.5.6.

Three things differ from the Claude and Codex hooks that the shared path was written for:

1. There is no per-submission prompt event. The submitted prompt is `lastUserInput`, a field on
   every event, and `PreInvocation` repeats it before every model call of a turn.
2. Stop continues the agent on `decision: "continue"`, not `"block"`; any other value lets the
   stop happen.
3. PostToolUse reports failure as an `error` message that is "empty if successful", not as an
   exit code or status word.

## Decision

1. **Hooks.** The plugin's `hooks.json` registers three fail-open command hooks: `PreInvocation`
   (prompt capture; with a session channel, a `userMessage` inject step), `PostToolUse` for
   `write_to_file|replace_file_content|multi_replace_file_content|run_command` (the rendered core
   capture callback), and `Stop` (with a session channel, the inbox; otherwise the delivery
   reminder). It registers no `PreToolUse` hook, so Antigravity's native permission flow stays
   the only decision authority. Each script gates on the launch environment before reading stdin
   or spawning, so an unbound session is untouched.
2. **One hook implementation.** The Stop and PreInvocation scripts call
   `ovld protocol hook-event --agent antigravity --payload-file -`, the same native mode the
   Claude `mcp_tool` hooks use. The connector codec maps a native event to a canonical hook type:
   a rule of kind `prompt.submitted` is `UserPromptSubmit`. A prompt read from a per-invocation
   event is recorded only when it differs from the last one recorded for the conversation; only a
   hash is stored. The working directory that locates the session-key cache comes from the
   payload's declared project root when it names an existing directory, because the hook itself
   runs in the plugin folder.
3. **`--hook-output`.** Native mode gains `--hook-output`, which prints only the `hookOutput`
   object on one line, so a shell hook can pass the answer through without a JSON parser.
4. **Stop dialect.** The delivery reminder is `{ decision: "continue", reason }` for Antigravity
   and `{ decision: "block", reason }` for Claude and Codex. The reminder is skipped while
   Antigravity reports `continuation_active: true` (as for Claude `stop_hook_active`) or
   `fullyIdle: false` (as for Claude's running background tasks). The inbox emits the same
   `continue` shape at Stop and `{ injectSteps: [{ userMessage }] }` at PreInvocation, both
   reported Delivered.
5. **Codec field `outcomeErrorPath`.** The event codec dialect gains `outcomeErrorPath`: a dotted
   path to an error-message string the harness documents as empty or omitted on success. A
   non-empty string decodes to `error`, an empty or absent field to `ok`, anything else stays
   unknown. The message is never retained. It is valid only on a `tool.completed` rule, exclusive
   with `outcomePath` and `successOnly`, and must cite harness evidence in the codec and be
   pinned by a normalized-event fixture. An absent field is success only because the matched
   rule already proved which native event this is.
6. **Version floor.** The descriptor's `versionRange` is `>=1.5.4`. An older agy still runs the
   hooks harmlessly; its payloads match no codec rule. Setup and doctor warn below the floor.

## Consequences

- Antigravity is tier 1 (Observational): `observe.prompt`, `observe.toolResult`,
  `observe.fileEdit` and `inject.turnBoundary` are fixture-proven, with post-only mutation
  evidence. `observe.prompt` moves from unsupported to supported on the `lastUserInput` evidence.
- `decide.*` stay not-implemented. A decision codec pins the exact PreToolUse bytes (remote allow
  is `auto_approve`, because Antigravity's `allow` only defers to the default policy; ask is
  silence), ready for when launches create session channels.
- Antigravity exports no conversation id to tool processes, so a chat-started attach cannot index
  its conversation; hooks act only in sessions Overlord launched.
- A launched session spawns `ovld` before every model call. Repeats stop before any backend call;
  the cost is accepted and recorded as a descriptor hazard.
