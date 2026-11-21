# ADR 0088: Claude hook identity, nested sessions and the headless Stop wait

Date: 2026-11-20
Status: accepted
Contract version: [179.2.2](../CHANGELOG.md#17922---2026-11-20)
Supersedes: none (amends ADR 0087)
Contract impact: patch

## Context

ADR 0087 moved the Claude hooks to `mcp_tool` calls. Three Claude Code changes since then bear
on them: a 30 s progress heartbeat while hooks run in `claude -p` and SDK sessions (2.1.323);
`agent_id`/`agent_type` on PreCompact, PostCompact and post-compaction SessionStart (2.1.321 and
2.1.323); and a session id of its own for a nested `claude -p` (2.1.317/318). Probes on 2.1.329,
recorded as Claude adapter fixtures, showed:

- every hook inside a subagent or fork carries the parent's `session_id` plus `agent_id` and
  `agent_type`; compaction keeps the `session_id` (`subagent-identity.json`);
- the main Stop fires while background subagents still run and lists them in `background_tasks`;
  each one ends with `SubagentStop`; the main agent is then woken by a harness-written
  `<task-notification>` prompt through UserPromptSubmit, and that turn ends in another main Stop
  (`subagent-stop-background.json`);
- a nested `claude -p` gets its own `session_id`, even with
  `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID=1`, but inherits the launch environment. Its MCP servers
  see the outer session's `CLAUDE_PID`, which Claude does not set for MCP servers itself;
- a 45 s Stop `mcp_tool` hook in `claude -p` emitted a heartbeat at 30 s and completed
  (`probe-stop-heartbeat.json`).

So the launch environment bound nested sessions to the parent's mission, a subagent's completion
notice was recorded as the user's follow-up, and the delivery reminder could fire before
background work finished.

## Decision

1. **Subagents bind to the parent.** Binding by `session_id` stays. Subagent and fork work
   belongs to the parent's objective. `SubagentStop` stays unregistered: a subagent's stop is not
   the end of the objective.
2. **Harness-written prompts are not follow-ups.** Native `hook-event` skips a Claude
   `<task-notification>` prompt.
3. **Background work defers the reminder.** The Stop hook templates `background_tasks`. While one
   is running, `hook-event` answers `{}` and the reminder waits for the later Stop.
4. **Nested sessions do not inherit the launch binding.** The hooks server treats a `CLAUDE_PID`
   other than its parent as nested. Its follow-up, Stop and decision hooks then use no launch
   binding (the binding variables are also withheld from the spawned CLI). The native-session
   index may still bind the nested session under its own id. File capture keeps the launch
   objective.
5. **Headless Stop wait.** `ovld agent-session inbox` claims at once and, without `--wait-ms`,
   polls every 2 s for up to 60 s only at a final Claude Stop (no running background task) in a
   headless session (`CLAUDE_CODE_ENTRYPOINT` `sdk-*`); `--wait-ms` is bounded at 120 s. A failed
   claim ends the wait. Interactive sessions never wait. The plugin's Stop hook timeout rises from
   30 s to 100 s, above the wait plus the inbox (16 s) and reminder (10 s) budgets. The CLI holds
   the rule; the hooks server only sizes its budget, and a test keeps the two equal.

## Consequences

- An instruction sent within 60 s of a headless run's last turn still reaches it. A headless run
  with a session channel ends up to 60 s later when nothing arrives.
- A session launched by an `ovld` process that itself runs inside a Claude Code tool inherits that
  outer `CLAUDE_PID` and is treated as nested: its follow-up, Stop and decision hooks fall back to
  the index.
- Codex, Cursor, Pi and Antigravity are unchanged. The skips key on Claude payload fields, and
  the nested gate lives in the Claude hooks mode of the shim.
