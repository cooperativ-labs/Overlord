import { getTicketIdentifier } from '@/lib/helpers/tickets';

export type PromptContext = 'electron' | 'cli' | 'web' | 'paste';

export type PromptOptions = {
  /** Agent token value to embed in MCP config (when available). Falls back to $AGENT_TOKEN placeholder. */
  token?: string;
  /** Supabase functions base URL for the MCP server, e.g. https://xyz.supabase.co/functions/v1/mcp */
  mcpUrl?: string;
  /** Optional user-level custom instructions to prepend to the prompt */
  customInstructions?: string | null;
};

/**
 * Builds the full prompt text for attaching a ticket to an LLM (e.g. when the user
 * pastes ticket context into Claude or ChatGPT). Includes ticket details and instructions
 * for the LLM to pass information back via the overlord protocol.
 */
type Ticket = {
  id: string;
  title: string | null;
  objective: string | null;
  acceptance_criteria: string | null;
  available_tools: string | null;
  execution_target: 'agent' | 'human' | null;
  project_id: string;
  status: string | null;
  priority: string | number | null;
};
type BuildTicketPromptMarkdownInput = {
  ticket: {
    id: string;
    title: string | null;
    objective: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    execution_target: 'agent' | 'human' | null;
    project_id: string;
    status: string | null;
    priority: string | number | null;
  };
  platformUrl: string;
  context?: PromptContext;
  options?: PromptOptions;
};

export function buildTicketPromptMarkdown({
  ticket,
  platformUrl,
  context,
  options
}: BuildTicketPromptMarkdownInput): string {
  const ref = getTicketIdentifier(ticket.id);
  const title = ticket.title ?? '(Untitled)';

  const section = (heading: string, body: string | null) =>
    body?.trim() ? `### ${heading}\n\n${body.trim()}\n` : '';
  const executionTargetLabel = ticket.execution_target === 'human' ? 'Human' : 'Agent';
  const projectLabel = ticket.project_id;

  const isLocal = context
    ? context === 'electron' || context === 'cli'
    : platformUrl.startsWith('http://localhost') ||
      platformUrl.startsWith('http://127.0.0.1') ||
      platformUrl.startsWith('http://0.0.0.0');

  const protocolSection = isLocal
    ? buildLocalProtocolSection(ticket.id, platformUrl)
    : buildRemoteProtocolSection(ticket.id, platformUrl, options);

  const customInstructions = options?.customInstructions?.trim();
  const customInstructionsSection = customInstructions
    ? `### Custom instructions

${customInstructions}
`
    : '';

  return `# Overlord — Agent Instructions

You are an AI coding agent working on ticket **${ref}: ${title}** via Overlord.
Complete the work described below, then deliver a summary back to the platform.

## Your Ticket

- **Reference:** ${ref}
- **Status:** ${ticket.status ?? 'unknown'}
- **Priority:** ${ticket.priority ?? 'unset'}
- **Execution Target:** ${executionTargetLabel}
- **Project ID:** ${projectLabel}

${section('Objective', ticket.objective)}
${section('Acceptance Criteria', ticket.acceptance_criteria)}
${section('Available Tools / Constraints', ticket.available_tools)}
${customInstructionsSection}
---

${protocolSection}`;
}

function buildLocalProtocolSection(ticketId: string, platformUrl: string): string {
  return `## Overlord Protocol

- **Base URL:** ${platformUrl}/api/protocol
- **Ticket ID:** ${ticketId}

The following environment variables are set for you: \`PLATFORM_URL\`, \`AGENT_TOKEN\`, \`TICKET_ID\`.

> **Running locally.** Use \`npx overlord protocol\` CLI for all protocol calls — auth and \`TICKET_ID\` are read from env automatically.

### 1 — Attach (always first)

\`\`\`bash
npx overlord protocol attach
\`\`\`

Prints response JSON to stdout. Store \`session.sessionKey\` — required for every subsequent call. Response also includes \`ticket\`, \`history\` (deliver events), \`artifacts\`, and \`sharedState\`.

### 2 — Update (after each meaningful step)

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --summary "What you did and why." --phase execute
\`\`\`

Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`. Use \`execute\` while working. Add \`--payload-json '{"notifications":[...]}'}\` to surface events in the UI.

### 4 — Ask (blocking question — stop working after calling)

\`\`\`bash
npx overlord protocol ask --session-key <sessionKey> --question "Specific question for the PM."
\`\`\`

Ticket moves to \`review\` until a human responds. Do not guess.

### 5 — Context (optional, persist across sessions)

\`\`\`bash
npx overlord protocol read-context --session-key <sessionKey>
npx overlord protocol write-context --session-key <sessionKey> --key "descriptive-key" --value '"json-value"'
\`\`\`

### 6 — Create follow-up ticket (human-only blockers)

\`\`\`bash
curl -sS -X POST "$PLATFORM_URL/api/protocol/create-ticket" -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" -d '{"sessionKey":"<sessionKey>","ticketId":"'$TICKET_ID'","title":"...","objective":"...","acceptanceCriteria":"...","executionTarget":"human"}'
\`\`\`

### 7 — Deliver (always last)

\`\`\`bash
npx overlord protocol deliver --session-key <sessionKey> \\
  --summary "Narrative: what you did, next steps." \\
  --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"..."},{"type":"next_steps","label":"Next steps","content":"..."}]'
\`\`\`

Artifact types: \`file_changes\`, \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`.

Deliver moves the ticket to \`review\`. Do not call if you used \`ask\` and haven't received an answer.

### 8 — Restart command

Include in your deliver artifacts. If omitted, \`/api/protocol/deliver\` appends one automatically.

\`\`\`bash
PLATFORM_URL=$PLATFORM_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=$TICKET_ID npx overlord resume claude
# or for Codex:
PLATFORM_URL=$PLATFORM_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=$TICKET_ID npx overlord resume codex
\`\`\`

---

## Rules

- Always attach first; always deliver when done.
- Post at least one update before delivering.
- If blocked on human-only work, create a follow-up ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately post an update with the user's message recorded verbatim in the summary before doing anything else.**
`;
}

/**
 * Builds an MCP server configuration block to include in the remote prompt.
 * Agents that support MCP (Claude Code, etc.) can configure this server to get
 * native tool access to Overlord instead of using raw curl/REST calls.
 */
function buildMcpConfigSection(mcpUrl: string, tokenValue: string, ticketId: string): string {
  const settingsJson = JSON.stringify(
    {
      mcpServers: {
        overlord: {
          type: 'url',
          url: mcpUrl,
          headers: { authorization: `Bearer ${tokenValue}` }
        }
      }
    },
    null,
    2
  );

  return `
### MCP Server (Recommended for Claude Code and compatible agents)

If your agent supports MCP, configure the Overlord MCP server for native tool access.
This is the preferred method — use the MCP tools instead of the curl/REST instructions below.

**Step 1** — Add to your project's \`.claude/settings.json\` (or global \`~/.claude/settings.json\`):

\`\`\`json
${settingsJson}
\`\`\`

**Step 2** — Available MCP tools (use these instead of curl):
- \`attach\` — attach to this ticket first (use ticketId: \`${ticketId}\`)
- \`update\` — post progress updates
- \`ask\` — ask a blocking question
- \`read_context\` / \`write_context\` — persist findings across sessions
- \`deliver\` — deliver completed work
- \`create_ticket\` — create a follow-up ticket for human work

> If you configure the MCP server, use MCP tools exclusively — do not mix MCP and REST calls in the same session.

---

### REST API (fallback if MCP is not available)
`;
}

function buildRemoteProtocolSection(
  ticketId: string,
  platformUrl: string,
  options?: PromptOptions
): string {
  const tokenValue = options?.token ?? '$AGENT_TOKEN';
  const mcpUrl = options?.mcpUrl;
  const mcpSection = mcpUrl ? buildMcpConfigSection(mcpUrl, tokenValue, ticketId) : '';

  return `## Overlord Protocol

- **Base URL:** ${platformUrl}/api/protocol
- **Ticket ID:** ${ticketId}
- **Auth header:** \`Authorization: Bearer $AGENT_TOKEN\`

The following environment variables are set for you: \`PLATFORM_URL\`, \`AGENT_TOKEN\`, \`TICKET_ID\`.
${mcpSection}

### 1 — Attach (always first, before any other work)

\`\`\`
POST $PLATFORM_URL/api/protocol/attach
Content-Type: application/json

{
  "ticketId": "$TICKET_ID",
  "agentIdentifier": "<your-agent-id, e.g. codex or claude-code>",
  "connectionMethod": "<mcp|cli|rest|chatgpt|claude_app|claude_code|other>",
  "metadata": {}
}
\`\`\`

Use this exact shell shape for the first attach call:

\`\`\`bash
curl -sS -X POST "$PLATFORM_URL/api/protocol/attach" \\
  -H "Authorization: Bearer $AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"ticketId":"'$TICKET_ID'","agentIdentifier":"codex","connectionMethod":"cli","metadata":{}}'
\`\`\`

Replace \`agentIdentifier\` and \`connectionMethod\` when needed for your runtime.
Do not build the JSON body with \`jq\` unless absolutely necessary.

The response includes:
- \`session.sessionKey\` — store this, required for every subsequent call
- \`ticket\` — full ticket record
- \`history\` — prior \`deliver\` events on this ticket
- \`artifacts\` — saved ticket artifacts from previous deliveries/sessions
- \`sharedState\` — persisted key/value context from previous sessions

### 2 — Post updates during work

Call after completing meaningful logical steps (not after every file change).

\`\`\`
POST $PLATFORM_URL/api/protocol/update
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "summary": "What you did and why.",
  "phase": "execute",
  "payload": {
    "notifications": [
      { "message": "Need clarification on migration order.", "kind": "question", "blocking": true },
      { "message": "Background sync started.", "level": "info", "kind": "event" }
    ]
  }
}
\`\`\`

Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`. Use \`execute\` while actively working.
When \`payload.notifications\` is provided, Overlord will fan these out into app-visible notification events.

### 3 — Ask a blocking question (when you cannot proceed)

\`\`\`
POST $PLATFORM_URL/api/protocol/ask
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "question": "Specific question for the PM.",
  "phase": "review"
}
\`\`\`

Stop working after calling ask. The ticket moves to \`review\` until a human responds. Do not guess.

### 5 — Read / write shared context (optional)

Persist findings or decisions that future agent sessions should know about.

\`\`\`
POST $PLATFORM_URL/api/protocol/read-context
{ "sessionKey": "...", "ticketId": "$TICKET_ID", "query": "optional key filter", "limit": 20 }

POST $PLATFORM_URL/api/protocol/write-context
{ "sessionKey": "...", "ticketId": "$TICKET_ID", "key": "descriptive-key", "value": <any JSON>, "tags": [] }
\`\`\`

### 6 — Create a follow-up ticket for human help (optional)

When you are blocked by a human-only action (for example local configuration, credentials, or access), create a new ticket in the same project.

\`\`\`
POST $PLATFORM_URL/api/protocol/create-ticket
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "title": "Short follow-up title",
  "objective": "What a human needs to do.",
  "acceptanceCriteria": "How to verify the human task is complete.",
  "executionTarget": "human"
}
\`\`\`

This endpoint creates the follow-up ticket in the same organization/project as the current ticket and links it in events.

### 7 — Deliver (always last, when work is fully complete)

\`\`\`
POST $PLATFORM_URL/api/protocol/deliver
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "summary": "Narrative: what you did, what you considered, and next steps for the PM.",
  "artifacts": [
    { "type": "file_changes", "label": "Files modified", "content": "git diff --stat output or file list" },
    { "type": "next_steps", "label": "Recommended next steps", "content": "Bulleted list." }
  ]
}
\`\`\`

Artifact types: \`file_changes\`, \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`.

Deliver moves the ticket to \`review\` and ends your session. Do not call deliver if you used ask and have not received an answer.

### 8 — Return a restart command on the ticket

Include a restart command in your deliver artifacts so a future session can relaunch from the ticket immediately.
If you omit it, \`/api/protocol/deliver\` will append one automatically based on your attached \`agentIdentifier\`.

For Claude Code sessions, use this format:

\`\`\`bash
PLATFORM_URL=$PLATFORM_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=$TICKET_ID npx overlord resume claude
\`\`\`

For Codex sessions:

\`\`\`bash
PLATFORM_URL=$PLATFORM_URL AGENT_TOKEN=$AGENT_TOKEN TICKET_ID=$TICKET_ID npx overlord resume codex
\`\`\`

To target a specific native agent session ID, optionally set one of:
- \`CLAUDE_SESSION_ID=<session-id>\` before \`npx overlord resume claude\`
- \`CODEX_SESSION_ID=<session-id>\` before \`npx overlord resume codex\`

---

## Rules

- Always attach before anything else.
- Always deliver when done — even for minor changes. The PM needs the feedback loop.
- Post at least one update before delivering.
- If blocked on human-only work, create a follow-up ticket in the same project using \`/api/protocol/create-ticket\`.
- Include a \`Restart session command\` artifact when delivering when possible. The deliver endpoint auto-appends one if missing.
- The \`summary\` in deliver is what the PM reads first — write it as a clear narrative, not a list of commands.
- Use \`write-context\` for constraints, or facts a future agent session should know.
- Prefer direct \`curl\` JSON payloads for protocol calls; avoid brittle shell quoting and \`jq\` payload wrappers.
- **If the user sends you a message during your session, immediately post an update with the user's message recorded verbatim in the summary before doing anything else.**
`;
}
