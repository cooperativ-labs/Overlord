---
name: overlord-mission
description: Use for chat-started Overlord work, when the user refers to an Overlord mission, ticket or objective and asks to create, find, inspect, discuss, connect or attach. Not needed in a session that Overlord launched, where the attach response carries the instructions.
---

<!-- @connector-core -->

## Claude Adapter Notes

- Agent identifier: `claude-code` for `ovld protocol create` and `ovld protocol prompt`.
- Native commands: `/overlord:attach`, `/overlord:connect`, `/overlord:load`, `/overlord:create`, `/overlord:prompt`, `/overlord:discuss-objective`, `/overlord:add-objectives`, `/overlord:record-work`.
- Hooks: the plugin's hooks are `mcp_tool` hooks served by its bundled `overlord-hooks` MCP server (Claude Code 2.1.328 or later). They record follow-up messages (`UserPromptSubmit`), capture changed files (`PostToolUse`) and remind you to deliver (`Stop`). Do not manually publish `user_follow_up` while they work. The Stop reminder does not deliver for you.
- Permission decisions: Overlord-launched sessions with a session channel also get a `PermissionRequest` hook. If the hooks server cannot be reached, Claude denies the request; do not work around that denial. Ask the user to run `ovld doctor`.
- CLI fallback: if Overlord MCP tools or hooks fail or are unavailable (for example `/mcp` shows `plugin:overlord:overlord-hooks` as failed, or a hook reports that its MCP server is not connected), use the equivalent `ovld protocol` command instead: `attach`, `update`, `ask`, `deliver`, `changes`. Declare the files you changed with `--paths` on `update` or `deliver`, because automatic capture is off. `ovld doctor` names the fix.
- Authentication: hooks and the CLI use shared `ovld auth` credentials, Overlord-launched environment variables, or `Overlord_USER_TOKEN` / `OVLD_USER_TOKEN`.

## Claude Command Mapping

- Create draft mission: `/overlord:create` or `ovld protocol create --agent claude-code --objectives-json '[{"objective":"..."}]'`
- Create and execute immediately: `/overlord:prompt` or `ovld protocol prompt --agent claude-code --objectives-json '[{"objective":"..."}]'`
- Load context without a session: `/overlord:load` or `ovld protocol load-context --mission-id <mission_id>`
- Submit a draft objective for discussion: `/overlord:discuss-objective` or `ovld protocol discuss-objective --mission-id <mission_id>`
- Connect this session: `/overlord:connect` or `ovld protocol connect --mission-id <mission_id>`
- Attach for execution: `/overlord:attach` or `ovld protocol attach --mission-id <mission_id>`
- Resume delivered work for follow-up execution: `ovld protocol resume-follow-up --mission-id <mission_id>`
- Add ordered follow-up objectives: `/overlord:add-objectives` or `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`
