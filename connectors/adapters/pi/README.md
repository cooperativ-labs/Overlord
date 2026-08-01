# PI Connector

The PI connector installs an Overlord Agent Skill and a small PI extension. It gives PI the
shared mission lifecycle instructions, observes scoped live-session events, delivers queued
instructions, optionally holds tool decisions, and exposes PI's native session ID for
review-session resume.

## Setup

Install PI separately, then install or refresh this adapter:

```bash
ovld agent-setup pi
ovld doctor
```

The adapter writes only Overlord-managed files under `~/.pi/agent`:

- `extensions/overlord.ts`
- `skills/overlord-mission/`
- `prompt-wrapper.md` and this README

Re-running setup is idempotent. `ovld doctor` reports missing or modified managed files and whether the `pi` binary is on `PATH`.

## Models and thinking

PI accepts provider-qualified models with `--model` and an independent `--thinking` level. The built-in catalog includes:

| Display name    | PI model ID                  |
| --------------- | ---------------------------- |
| GLM 5.2         | `zai/glm-5.2`                |
| Claude Opus 4.8 | `anthropic/claude-opus-4-8`  |
| GPT-5.6 Terra   | `openai-codex/gpt-5.6-terra` |

Authenticate the matching PI provider through PI's login/configuration flow or its supported environment variables. Use `pi --list-models` to inspect the models available to the current PI configuration.

## Follow-ups and resume

The extension records human input after the initial Overlord launch prompt through `ovld
protocol hook-event` for mission attribution. In a scoped live channel it separately sends
normalized events through `ovld agent-session event` and checks for queued instructions. These
paths never block PI's input pipeline if Overlord is unavailable. PI has no native
permission-request prompt; its optional remote decision path is an in-process `tool_call`
interceptor instead.

When PI supplies a native session ID, Overlord's review UI can reopen it with:

```bash
pi --session <session-id>
```

## Deliberate omissions

- **No local MCP shim and no MCP config.** PI integrates through the single `extensions/overlord.ts` extension, which calls `ovld protocol` directly.
- **No native permission dialog.** Pi's `tool_call` interceptor may be enabled for remote
  allow/deny, but it has no terminal prompt to fall back to. When the decision deadline,
  transport, or CLI fails, the tool proceeds. It is disabled by default and only activates when
  a launcher supplies both `OVERLORD_PI_REMOTE_DECISIONS=enabled` (workspace ceiling) and
  `OVERLORD_PI_PROJECT_REMOTE_DECISIONS=enabled` (project opt-in). Current builds do not expose
  those gates as product settings, so this remains a development path. Do not set either value
  casually: the enablement copy must state the fail-open deadline.
- **No app-server or direct backend client.** The extension uses `pi.exec('ovld', ...)` only.
  For its no-stdin process API it creates an owner-only temporary payload file for one CLI call,
  then removes it; raw event input never travels in argv or over the network.
- **No `commands/` directory or rules file.** Protocol operations are reached through the mission skill and the extension.

See the [adapter capability matrix](../../README.md#adapter-capability-matrix) for how this compares across adapters.
