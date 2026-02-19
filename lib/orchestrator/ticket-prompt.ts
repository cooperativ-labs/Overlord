import { getTicketIdentifier } from '@/lib/helpers/tickets';

/**
 * Builds the full prompt text for attaching a ticket to an LLM (e.g. when the user
 * pastes ticket context into Claude or ChatGPT). Includes ticket details and instructions
 * for the LLM to pass information back via the orchestrator protocol.
 */
export function buildTicketPromptMarkdown(
  ticket: {
    id: string;
    title: string | null;
    objective: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    status: string | null;
    priority: string | number | null;
  },
  platformUrl: string
): string {
  const ref = getTicketIdentifier(ticket.id);
  const title = ticket.title ?? '(Untitled)';

  const section = (heading: string, body: string | null) =>
    body?.trim() ? `### ${heading}\n\n${body.trim()}\n` : '';

  return `# Cooperativ Orchestrator — Agent Instructions

You are an AI coding agent working on ticket **${ref}: ${title}** via the Cooperativ orchestrator.
Complete the work described below, then deliver a summary back to the platform.

## Your Ticket

- **Reference:** ${ref}
- **Status:** ${ticket.status ?? 'unknown'}
- **Priority:** ${ticket.priority ?? 'unset'}

${section('Objective', ticket.objective)}
${section('Acceptance Criteria', ticket.acceptance_criteria)}
${section('Available Tools / Constraints', ticket.available_tools)}
---

## Orchestrator Protocol

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
  "agentIdentifier": "claude-code",
  "connectionMethod": "claude_code",
  "metadata": {}
}
\`\`\`

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
  "phase": "execute"
}
\`\`\`

Setting \`phase\` changes the ticket's visible status. Use \`"execute"\` while actively working.

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

### 4 — Read / write shared context (optional)

Persist findings or decisions that future agent sessions should know about.

\`\`\`
POST $PLATFORM_URL/api/protocol/read-context
{ "sessionKey": "...", "ticketId": "$TICKET_ID", "query": "optional key filter", "limit": 20 }

POST $PLATFORM_URL/api/protocol/write-context
{ "sessionKey": "...", "ticketId": "$TICKET_ID", "key": "descriptive-key", "value": <any JSON>, "tags": [] }
\`\`\`

### 5 — Deliver (always last, when work is fully complete)

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

Deliver marks the ticket \`complete\` and ends your session. Do not call deliver if you used ask and have not received an answer.

---

## Rules

- Always attach before anything else.
- Always deliver when done — even for minor changes. The PM needs the feedback loop.
- Post at least one update before delivering.
- The \`summary\` in deliver is what the PM reads first — write it as a clear narrative, not a list of commands.
- Use \`write-context\` for decisions, constraints, or facts a future agent session should know.
`;
}
