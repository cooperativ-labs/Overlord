---
name: agent-terminal-connectors
description: Current Overlord terminal and connector patterns for Electron, web MCP clients, cloud agents, and the human CLI, including which auth flow each path must use.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# agent-terminal-connectors

## Instructions

Use this skill when you are changing:

- agent launch flows
- Electron terminal or bundled CLI behavior
- MCP connection instructions or auth behavior
- CLI login or saved credential handling
- prompts, docs, or setup steps that tell users how agents connect to Overlord

## Current connector matrix

Treat this table as the default architecture unless the task explicitly changes it.

| Surface | Transport | Auth | Notes |
|---|---|---|---|
| Electron app | Local terminal + local `ovld`/`npx overlord` CLI | `AGENT_TOKEN` | Overlord desktop pre-fills `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID`. |
| Web-based agent interfaces | MCP at `/api/mcp` | OAuth 2.1 / OIDC | Prefer direct OAuth with the MCP protected-resource flow. No agent-token exchange by default. |
| Cloud agents configured by env vars | MCP at `/api/mcp` | `AGENT_TOKEN` | These agents usually cannot complete an interactive browser login, so they use env-provided credentials. |
| Human-facing CLI (`ovld`, `npx overlord`) | Local CLI commands | OAuth login for the human, then stored credentials | CLI login uses Supabase OAuth PKCE and may exchange the OAuth session for an agent token for protocol/MCP access. |

## Non-negotiable rules

- Do not describe Electron as an OAuth-first runtime for agent work. Electron launches agents with local env vars and an agent token.
- Do not describe the web MCP flow as agent-token based unless you are documenting a legacy fallback explicitly.
- Do not require browser OAuth for headless cloud-agent env-var flows.
- Do not tell humans to hand-copy bearer tokens into the CLI when `ovld auth login` or the installed credential flow should handle it.
- Keep `/api/mcp` as the user-facing MCP endpoint unless the task explicitly targets the Supabase edge-function URL.

## Source of truth

Read the relevant files before changing behavior:

- MCP auth and discovery: `docs/MCP_AUTH_AND_INTEGRATION.md`
- Supabase OAuth details: `.claude/skills/supabase-oauth/SKILL.md`
- Ticket prompts and launch instructions: `lib/overlord/ticket-prompt.ts`
- CLI OAuth login: `bin/_cli/auth.mjs` and `packages/overlord-cli/bin/_cli/auth.mjs`
- CLI credential resolution: `bin/_cli/credentials.mjs` and `packages/overlord-cli/bin/_cli/credentials.mjs`
- Electron launch env setup: `electron/services/agent-launcher.ts`
- MCP metadata and route shape: `lib/mcp/oauth-metadata.ts`, `app/api/mcp/route.ts`, and `app/api/mcp/[...path]/route.ts`
- Bundle/setup instructions: `electron/services/agent-bundle/` and the latest `CHANGELOG.md`

## How to reason about each surface

### 1. Electron

- Electron is the local desktop shell around the web app and local terminal launchers.
- For agent execution, it should launch the local CLI or agent command with `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID`.
- Prefer fixing Electron launch/setup issues in Electron services, not by introducing browser-only OAuth steps into the terminal flow.
- When instructions are bundle-aware, keep the ticket prompt slim and rely on the installed bundle/AGENTS instructions.

### 2. Web-based interfaces

- Browser-hosted or connector-style interfaces should use MCP as an OAuth-protected resource.
- The public MCP URL is `{PLATFORM_URL}/api/mcp`.
- OAuth discovery should happen through the protected-resource metadata path on the same origin.
- Prefer OAuth language such as "sign in", "consent", "dynamic client registration", and "PKCE" instead of "generate an agent token".

### 3. Cloud agents via env vars

- If the agent is running remotely and is configured by env vars, assume non-interactive auth unless the task says otherwise.
- Use `OVERLORD_URL` plus `AGENT_TOKEN` and point the client at the hosted MCP endpoint.
- Keep these instructions deterministic and shell-friendly.
- Be careful not to replace this path with a loopback OAuth flow that only works on a human workstation.

### 4. Human-facing CLI

- The human CLI authenticates the user via OAuth Authorization Code + PKCE.
- The login flow begins at `/api/auth/config`, opens the browser, listens on a loopback callback, and persists credentials locally.
- Runtime auth resolution should prefer env overrides like `AGENT_TOKEN`, but the documented/default human flow is OAuth login, not manual token entry.
- If you change CLI auth behavior, keep `bin/_cli` and `packages/overlord-cli/bin/_cli` aligned.

## Implementation workflow

1. Identify which surface from the matrix the task affects.
2. Open the source-of-truth files for that surface.
3. Confirm whether the change is auth behavior, transport behavior, setup UX, or prompt/documentation wording.
4. Update the surface-specific implementation first.
5. Then update prompts, setup text, or docs so they match the actual behavior.
6. If CLI code is touched, mirror the change in both CLI copies.

## Documentation and prompt rules

- Distinguish clearly between "human login" and "agent runtime auth".
- Distinguish clearly between "local CLI/protocol commands" and "MCP requests".
- For Electron-launched tickets, prefer wording that says the env vars are already set.
- For web MCP connectors, prefer wording that says OAuth is automatic or connector-driven.
- For cloud-agent docs, show env vars and the MCP endpoint explicitly.

## Anti-patterns to avoid

- Reusing old permission-notification language as if it defines the connector architecture.
- Mixing up the human CLI login flow with the credentials used later by the launched agent process.
- Pointing browser clients directly at a Supabase edge-function URL when `/api/mcp` is the intended entrypoint.
- Telling every surface to use agent tokens "for consistency". The product intentionally uses different auth flows by surface.
- Updating prompt copy without checking the actual launch/auth code paths first.

## Examples

This skill should trigger for requests like:

- "Rewrite the agent terminal connector guidance."
- "Update the Electron/CLI launch docs for the new auth flow."
- "Switch the MCP setup instructions to OAuth."
- "Document how cloud agents should connect with env vars."

<!-- version: 2.0.0 -->
