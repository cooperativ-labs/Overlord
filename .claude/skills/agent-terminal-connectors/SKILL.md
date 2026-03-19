---
name: agent-terminal-connectors
description: Current Overlord terminal and connector patterns for Electron, web MCP clients, cloud agents, and the human CLI, including the ovld protocol lifecycle, auth flows, and prompt modes.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# agent-terminal-connectors

## Instructions

Use this skill when you are changing:

- agent launch flows (Electron or CLI)
- `ovld protocol` commands or the protocol API endpoints they call
- MCP connection instructions or auth behavior
- CLI login or saved credential handling
- the ticket prompt system (`ticket-prompt.ts`)
- prompts, docs, or setup steps that tell users/agents how to connect to Overlord

## Current connector matrix

Treat this table as the default architecture unless the task explicitly changes it.

| Surface | Transport | Auth | Notes |
|---|---|---|---|
| Electron app | Local terminal → `ovld protocol ...` CLI commands | `AGENT_TOKEN` env var | Electron pre-fills `OVERLORD_URL`, `AGENT_TOKEN`, `TICKET_ID`, and `AGENT_IDENTIFIER`. Fetches context from `/api/protocol/context/[ticketId]`. |
| CLI-launched agents | `ovld connect <agent>` → spawns agent with `ovld protocol ...` | `AGENT_TOKEN` env var or stored credentials | `ovld connect claude --ticket-id <id>` fetches context and spawns the agent process. |
| Web-based MCP clients | MCP JSON-RPC at `/api/mcp` | OAuth 2.1 / OIDC | Uses protected-resource metadata discovery. MCP tools mirror protocol endpoints (attach, update, deliver, ask, etc.). |
| Cloud agents (headless) | MCP at `/api/mcp` or direct HTTP to `/api/protocol/*` | `AGENT_TOKEN` env var | Non-interactive auth. Set `OVERLORD_URL` + `AGENT_TOKEN` in the environment. |
| Human-facing CLI (`ovld`) | Local CLI commands | OAuth PKCE login → stored credentials | `ovld auth login` opens browser, stores credentials in `~/.overlord-credentials`. Falls back to `AGENT_TOKEN` env var. |

## Agent protocol lifecycle

All local agents (Electron and CLI-launched) use `ovld protocol` commands to communicate with Overlord. The lifecycle is:

```
ovld protocol attach   → get sessionKey, ticket data, history, artifacts
ovld protocol update   → post progress (phase: draft/execute/review/deliver/complete/blocked)
ovld protocol record-change-rationales → persist structured change rationales to the DB
ovld protocol ask      → ask a blocking question (ticket moves to review)
ovld protocol deliver  → submit completed work with artifacts and change rationales
```

Additional commands:

```
ovld protocol connect        → lightweight attach (session only, no full context)
ovld protocol load-context   → read-only ticket fetch without creating a session
ovld protocol read-context   → read persistent shared state
ovld protocol write-context  → store persistent shared state for future sessions
ovld protocol spawn          → create a follow-up ticket + attach in one call
ovld protocol artifact-upload-file    → upload a file artifact (prepare → S3 → finalize)
ovld protocol artifact-prepare-upload → begin multi-step artifact upload
ovld protocol artifact-finalize-upload → finalize artifact after S3 upload
ovld protocol artifact-get-download-url → get signed download URL
```

### Key protocol details

- All protocol commands POST to `/api/protocol/<endpoint>` with `Authorization: Bearer <AGENT_TOKEN>`.
- `attach` returns a `sessionKey` that must be passed to all subsequent commands via `--session-key`.
- `update` accepts `--phase`, `--summary`, `--change-rationales-json`, and `--change-rationales-file`.
- `record-change-rationales` accepts `--summary`, `--phase`, and `--change-rationales-json`/`--change-rationales-file`, and persists those records to the `change_rationales` table.
- `deliver` accepts `--summary`, `--artifacts-json`/`--artifacts-file`, and `--change-rationales-json`/`--change-rationales-file`.
- `ask` sets the ticket to review status and the agent should stop and wait for a response.

## Ticket prompt system

The ticket prompt (`lib/overlord/ticket-prompt.ts`) generates agent instructions in two modes:

### Bundle mode (default when `ovld` CLI is installed)

Slim prompt — just the ticket ID, Overlord URL, and a pointer to the installed skill:

```
> Launched from Overlord desktop. This terminal already has
> OVERLORD_URL, AGENT_TOKEN, and TICKET_ID set.

Use your installed Overlord local workflow instructions.

ovld protocol attach --ticket-id <id>
```

The agent's installed Overlord skill (e.g. `.claude/skills/overlord-local/SKILL.md`) contains the full protocol reference.

### Legacy mode (fallback when bundle is not detected)

Full inline walkthrough of all protocol steps: attach → update → ask → read/write context → artifacts → deliver. Includes agent-specific restart command templates with flags from the user's saved agent config.

### Prompt contexts

The prompt is tailored per launch context:

| Context | Via | Typical mode |
|---|---|---|
| `electron` | Electron launcher → `/api/protocol/context/[ticketId]?context=electron` | Bundle or legacy |
| `cli` | `ovld connect <agent>` → `/api/protocol/context/[ticketId]?context=cli` | Bundle or legacy |
| `web` | Copy-to-clipboard from UI | Legacy (no CLI available) |
| `paste` | Manual paste | Legacy |

### Agent config integration

User agent configs are stored in the `user_agent_configs` database table (per-user, per-agent-type). The prompt system reads these to:

- Append custom flags to agent launch/restart commands (e.g. `--enable-auto-mode`, `--model claude-opus-4-1`)
- Include per-agent customizations in the restart command template

## Launch flows

### Electron launch (`electron/services/agent-launcher.ts`)

1. `prepareAgentLaunch()` fetches context markdown from `/api/protocol/context/[ticketId]`
2. Writes context to a temp file (`/tmp/overlord-ctx-*.md`, expires in 30 min)
3. Sets env vars: `OVERLORD_URL`, `OVERLORD_CONNECTOR_URL`, `AGENT_TOKEN`, `TICKET_ID`, `AGENT_IDENTIFIER`
4. Installs a Claude PermissionRequest hook (bash script → POST to `/api/protocol/permission-request`)
5. Merges hook settings into `~/.claude/settings.json`
6. Spawns agent command in PTY:
   - Claude: `claude --append-system-prompt "$(cat /tmp/ctx.md)" --settings /tmp/settings.json "Start working..."`
   - Codex: `codex "$(cat /tmp/ctx.md)"`
   - OpenCode: `opencode --prompt "$(cat /tmp/ctx.md)"`
   - Gemini: `gemini "$(cat /tmp/ctx.md)"`

### CLI launch (`bin/_cli/launcher.mjs`)

- `ovld connect <agent> --ticket-id <id>` — fetches context, spawns agent CLI
- `ovld restart <agent> --ticket-id <id>` — fetches context with agent-specific resume flags
- `ovld context` — prints raw context markdown to stdout

### Credential resolution (`bin/_cli/credentials.mjs`)

Priority: env vars (`OVERLORD_URL`, `AGENT_TOKEN`) → stored credentials (`~/.overlord-credentials`).
Builds `Authorization: Bearer <AGENT_TOKEN>` header. Default timeout: 30s (override with `--timeout` or `OVERLORD_TIMEOUT`).

## MCP integration

### Endpoint

`/api/mcp` proxies JSON-RPC to the Supabase edge function at `{SUPABASE_URL}/functions/v1/mcp`.

### Auth methods (in precedence order)

1. **Agent token** — look up bearer in `agent_tokens` table, validate not revoked/expired
2. **Supabase OAuth JWT** — JWKS verification, fallback to `supabase.auth.getUser(token)`

### Discovery

Protected-resource metadata at `/.well-known/oauth-protected-resource/api/mcp` declares Supabase as the authorization server with PKCE/OIDC support.

### MCP tools available

MCP exposes the same operations as the CLI protocol commands: `attach`, `update`, `record_change_rationales`, `ask`, `deliver`, `read_context`, `write_context`, `create_ticket`, `artifact_prepare_upload`, `artifact_finalize_upload`, `artifact_get_download_url`.

### MCP config example (for remote agents)

```json
{
  "mcpServers": {
    "overlord": {
      "type": "url",
      "url": "{PLATFORM_URL}/api/mcp",
      "headers": { "authorization": "Bearer <AGENT_TOKEN>" }
    }
  }
}
```

## Non-negotiable rules

- Do not describe Electron as an OAuth-first runtime for agent work. Electron launches agents with local env vars and an agent token.
- Do not describe the web MCP flow as agent-token based unless documenting a legacy fallback.
- Do not require browser OAuth for headless cloud-agent flows.
- Do not tell humans to hand-copy bearer tokens into the CLI when `ovld auth login` should handle it.
- Keep `/api/mcp` as the user-facing MCP endpoint — never point clients at the raw Supabase edge-function URL.
- Local agents always use `ovld protocol ...` commands, not raw HTTP calls.

## Source of truth

Read the relevant files before changing behavior:

| Area | Files |
|---|---|
| Protocol API endpoints | `app/api/protocol/*/route.ts` |
| Protocol auth layer | `lib/overlord/protocol-auth.ts` |
| Ticket prompt generation | `lib/overlord/ticket-prompt.ts` |
| CLI entry point & dispatch | `bin/_cli/index.mjs` |
| CLI protocol commands | `bin/_cli/protocol.mjs` |
| CLI launcher commands | `bin/_cli/launcher.mjs` |
| CLI credential resolution | `bin/_cli/credentials.mjs` |
| CLI OAuth login | `bin/_cli/auth.mjs` |
| Electron agent launcher | `electron/services/agent-launcher.ts` |
| MCP proxy route | `app/api/mcp/route.ts`, `app/api/mcp/[...path]/route.ts` |
| MCP edge function auth | `supabase/functions/mcp/auth.ts` |
| MCP OAuth metadata | `lib/mcp/oauth-metadata.ts` |
| Protected-resource metadata | `app/.well-known/oauth-protected-resource/[...path]/route.ts` |
| MCP auth docs | `docs/MCP_AUTH_AND_INTEGRATION.md` |
| Supabase OAuth skill | `.claude/skills/supabase-oauth/SKILL.md` |
| Bundle setup | `electron/services/agent-bundle/` |
| Agent configs (DB) | `lib/actions/agent-config.ts`, `lib/schemas/agent-config.ts` |

## How to reason about each surface

### 1. Electron

- Electron is the local desktop shell around the web app and local terminal launchers.
- For agent execution, it calls `prepareAgentLaunch()` which fetches context, writes temp files, sets env vars, installs the permission hook, and spawns the agent.
- The permission hook posts tool-permission requests to `/api/protocol/permission-request` so the UI can show notification badges on Kanban cards.
- Prefer fixing Electron launch/setup issues in `electron/services/`, not by introducing browser-only OAuth steps into the terminal flow.
- When the bundle is installed, keep the ticket prompt slim and rely on the agent's installed skill.

### 2. CLI-launched agents

- `ovld connect <agent> --ticket-id <id>` is the primary way humans launch agents from a terminal.
- The CLI fetches context from `/api/protocol/context/[ticketId]?context=cli`, writes it to a temp file, and spawns the agent.
- `ovld restart <agent> --ticket-id <id>` re-launches with resume-specific flags.
- The spawned agent then uses `ovld protocol attach/update/deliver` to communicate with Overlord.

### 3. Web-based MCP clients

- Browser-hosted or connector-style interfaces should use MCP as an OAuth-protected resource at `{PLATFORM_URL}/api/mcp`.
- OAuth discovery happens through the protected-resource metadata path on the same origin.
- Prefer OAuth language: "sign in", "consent", "dynamic client registration", "PKCE".
- MCP tools mirror the protocol endpoints, so the agent workflow is the same.

### 4. Cloud agents (headless)

- Remote agents configured by env vars use non-interactive auth.
- Set `OVERLORD_URL` + `AGENT_TOKEN` and point the MCP client at the hosted `/api/mcp` endpoint.
- Keep instructions deterministic and shell-friendly.
- Do not replace this path with a loopback OAuth flow that only works on a human workstation.

### 5. Human-facing CLI

- The human CLI authenticates via OAuth Authorization Code + PKCE.
- `ovld auth login` → fetches `/api/auth/config`, opens browser, listens on loopback callback, stores credentials in `~/.overlord-credentials`.
- Runtime auth resolution prefers env var overrides (`AGENT_TOKEN`), but the default human flow is OAuth login.
- If you change CLI auth behavior, keep `bin/_cli` and `packages/overlord-cli/bin/_cli` aligned.

## Implementation workflow

1. Identify which surface from the matrix the task affects.
2. Open the source-of-truth files for that surface.
3. Confirm whether the change is auth behavior, transport behavior, setup UX, or prompt/documentation wording.
4. Update the surface-specific implementation first.
5. Then update prompts, setup text, or docs so they match the actual behavior.
6. If CLI code is touched, mirror the change in both CLI copies (`bin/_cli` and `packages/overlord-cli/bin/_cli`).

## Documentation and prompt rules

- Distinguish clearly between "human login" and "agent runtime auth".
- Distinguish clearly between "local `ovld protocol` commands" and "MCP JSON-RPC requests".
- For Electron-launched tickets, prefer wording that says the env vars are already set.
- For web MCP connectors, prefer wording that says OAuth is automatic or connector-driven.
- For cloud-agent docs, show env vars and the MCP endpoint explicitly.
- For CLI-launched agents, emphasize `ovld connect` and the `ovld protocol` lifecycle.

## Anti-patterns to avoid

- Telling agents to make raw HTTP calls when they should use `ovld protocol` commands.
- Mixing up the human CLI login flow with the credentials used by the launched agent process.
- Pointing browser clients directly at a Supabase edge-function URL when `/api/mcp` is the intended entrypoint.
- Telling every surface to use agent tokens "for consistency" — the product intentionally uses different auth flows by surface.
- Updating prompt copy without checking the actual launch/auth code paths first.
- Omitting the `--session-key` from protocol commands after attach.
- Forgetting that `deliver` and `update` support `--change-rationales-json` for tracking meaningful changes.

## Examples

This skill should trigger for requests like:

- "Rewrite the agent terminal connector guidance."
- "Update the Electron/CLI launch docs for the new auth flow."
- "Switch the MCP setup instructions to OAuth."
- "Document how cloud agents should connect with env vars."
- "Add a new protocol command to the CLI."
- "Change what the ticket prompt tells agents to do."

<!-- version: 3.0.0 -->
