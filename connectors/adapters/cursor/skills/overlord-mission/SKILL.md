---
name: overlord-mission
description: Use for the shared Overlord workflow whenever the user refers to an Overlord mission or ticket.
---

<!-- @connector-core -->

## Cursor Adapter Notes

- Agent identifier: `cursor` for `ovld protocol create` and `ovld protocol prompt`.
- Native commands: `/attach`, `/connect`, `/load`, `/create`, `/prompt`, `/discuss-objective`, `/add-objectives`, `/record-work`.
- Follow-up capture: the installed `beforeSubmitPrompt` hook records ordinary post-delivery user messages. Do not manually publish `user_follow_up` unless the hook is unavailable.
- Permission decisions: installed `beforeShellExecution` and `beforeMCPExecution` hooks call the
  scoped `ovld agent-session request` path. A remote allow/deny uses Cursor's flat native
  response; timeout or failure emits nothing and leaves Cursor authoritative.
- Edit capture: the installed `postToolUse` hook passes `--agent cursor`; only a path the Cursor
  codec normalizes as `file.edited` becomes objective-bound, non-exclusive
  `declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent
  no-ops. Mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown,
  and unmapped callbacks, record unavailable evidence health.
- Stop hook: the installed `stop` hook may auto-submit one pending-delivery reminder but does not deliver for you.
- MCP bridge: the installed `overlord` MCP server exposes the hosted-compatible `overlord_*` mission tool catalog backed by `ovld protocol`.
- Authentication: use shared `ovld auth` credentials, Overlord-launched environment variables, or `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`.

## Cursor Command Mapping

- Create draft mission: `/create` or `ovld protocol create --agent cursor --objectives-json '[{"objective":"..."}]'`
- Create and execute immediately: `/prompt` or `ovld protocol prompt --agent cursor --objectives-json '[{"objective":"..."}]'`
- Load context without a session: `/load` or `ovld protocol load-context --mission-id <mission_id>`
- Submit a draft objective for discussion: `/discuss-objective` or `ovld protocol discuss-objective --mission-id <mission_id>`
- Connect this session: `/connect` or `ovld protocol connect --mission-id <mission_id>`
- Attach for execution: `/attach` or `ovld protocol attach --mission-id <mission_id>`
- Resume delivered work for follow-up execution: `ovld protocol resume-follow-up --mission-id <mission_id>`
- Add ordered follow-up objectives: `/add-objectives` or `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`
