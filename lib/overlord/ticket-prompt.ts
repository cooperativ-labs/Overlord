import { getTicketIdentifier } from '@/lib/helpers/tickets';

/**
 * Builds the full prompt text for attaching a ticket to an LLM (e.g. when the user
 * pastes ticket context into Claude or ChatGPT). Includes ticket details and instructions
 * for the LLM to pass information back via the overlord protocol.
 */
export function buildTicketPromptMarkdown(
  ticket: {
    id: string;
    title: string | null;
    objective: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    execution_target: 'agent' | 'human' | null;
    project_id: string | null;
    status: string | null;
    priority: string | number | null;
  },
  platformUrl: string
): string {
  const ref = getTicketIdentifier(ticket.id);
  const title = ticket.title ?? '(Untitled)';

  const section = (heading: string, body: string | null) =>
    body?.trim() ? `### ${heading}\n\n${body.trim()}\n` : '';
  const executionTargetLabel = ticket.execution_target === 'human' ? 'Human' : 'Agent';
  const projectLabel = ticket.project_id ?? 'none';

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
---

## Overlord Protocol

- **Base URL:** ${platformUrl}/api/protocol
- **Ticket ID:** ${ticket.id}
- **Auth header:** \`Authorization: Bearer $AGENT_TOKEN\`

The following environment variables are set for you: \`PLATFORM_URL\`, \`AGENT_TOKEN\`, \`TICKET_ID\`.

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
curl -sS -X POST "$PLATFORM_URL/api/protocol/attach" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"'$TICKET_ID'","agentIdentifier":"codex","connectionMethod":"cli","metadata":{}}'
\`\`\`

Replace \`agentIdentifier\` and \`connectionMethod\` when needed for your runtime.
Do not build the JSON body with \`jq\` unless absolutely necessary.

The response includes:
- \`session.sessionKey\` — store this, required for every subsequent call
- \`ticket\` — full ticket record
- \`history\` — prior agent events on this ticket
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

Setting \`phase\` changes the ticket's visible status. Use \`"execute"\` while actively working.
When \`payload.notifications\` is provided, Overlord will fan these out into app-visible notification events.

### 3 — Record important decisions

Call this when you make a meaningful implementation decision that future sessions should inherit.

\`\`\`
POST $PLATFORM_URL/api/protocol/decision
{
  "sessionKey": "<from attach>",
  "ticketId": "$TICKET_ID",
  "title": "Short decision summary",
  "rationale": "Why this choice was made.",
  "impact": "Tradeoffs or follow-up implications."
}
\`\`\`

### 4 — Ask a blocking question (when you cannot proceed)

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
  "summary": "Narrative: what you did, what you considered, key decisions, and next steps for the PM.",
  "artifacts": [
    { "type": "file_changes", "label": "Files modified", "content": "git diff --stat output or file list" },
    { "type": "next_steps", "label": "Recommended next steps", "content": "Bulleted list." }
  ]
}
\`\`\`

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
- Use \`write-context\` for decisions, constraints, or facts a future agent session should know.
- Prefer direct \`curl\` JSON payloads for protocol calls; avoid brittle shell quoting and \`jq\` payload wrappers.
`;
}
