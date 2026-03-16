import type { InstructionMode } from '@/lib/overlord/agent-capabilities';
import { buildPromptContext } from '@/lib/overlord/prompt-context';
import {
  generateAskPayloadExample,
  generateAttachPayloadExample,
  generateDeliverPayloadExample,
  generateUpdatePayloadExample
} from '@/lib/overlord/protocol-schema-utils';
import type { AgentConfig } from '@/lib/schemas/agent-config';

export type PromptContext = 'electron' | 'cli' | 'web' | 'paste';
export type PromptLaunchMode = 'run' | 'ask';

export type PromptOptions = {
  /** Supabase functions base URL for the MCP server, e.g. https://xyz.supabase.co/functions/v1/mcp */
  mcpUrl?: string;
  /** Optional user-level custom instructions to prepend to the prompt */
  customInstructions?: string | null;
  /** Launch mode for this prompt. Ask mode guides the agent to ask and stop. */
  launchMode?: PromptLaunchMode;
  /** Optional agent configurations (flags, preferences) keyed by agent type. */
  agentConfigs?: Record<string, AgentConfig>;
  /** Instruction mode: 'bundle' emits a slim prompt, 'legacy' emits the full protocol walkthrough. */
  instructionMode?: InstructionMode;
};

/**
 * Builds the full prompt text for attaching a ticket to an LLM (e.g. when the user
 * pastes ticket context into Claude or ChatGPT). Includes ticket details and instructions
 * for the LLM to pass information back via the overlord protocol.
 */
type Ticket = {
  id: string;
  title: string | null | undefined;
  objective: string | null;
  acceptance_criteria: string | null;
  available_tools: string | null;
  constraints?: string | null;
  output_format?: string | null;
  execution_target: 'agent' | 'human' | null;
  project_id: string;
  status: string | null;
  priority: string | number | null;
};
type BuildTicketPromptMarkdownInput = {
  ticket: Ticket;
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
  const ref = ticket.id;
  const launchMode = options?.launchMode ?? 'run';
  const instructionMode = options?.instructionMode ?? 'legacy';

  const isLocal = context
    ? context === 'electron' || context === 'cli'
    : platformUrl.startsWith('http://localhost') ||
      platformUrl.startsWith('http://127.0.0.1') ||
      platformUrl.startsWith('http://0.0.0.0');

  const { promptContext } = buildPromptContext({
    ticket,
    customInstructions: options?.customInstructions,
    launchMode
  });

  // Bundle-backed agents get a slim prompt — protocol details are in their installed config
  if (isLocal && instructionMode === 'bundle') {
    const protocolSection = buildSlimLocalProtocolSection(ticket.id, platformUrl, context);
    return `# Overlord — Agent Instructions

You are an AI coding agent working on ticket **${ref}** via Overlord.
Complete the work described below, then deliver a summary back to the platform.

${promptContext}
---

${protocolSection}`;
  }

  const protocolSection = isLocal
    ? buildLocalProtocolSection(ticket.id, platformUrl, options?.agentConfigs, context, launchMode)
    : buildRemoteProtocolSection(ticket.id, platformUrl, options, launchMode);

  return `# Overlord — Agent Instructions

You are an AI coding agent working on ticket **${ref}** via Overlord.
Complete the work described below, then deliver a summary back to the platform.

${promptContext}
---

${protocolSection}`;
}

/**
 * Slim protocol section for agents with the Overlord local bundle installed.
 * Protocol details live in the agent's installed config (Claude skill / Codex AGENTS.md),
 * so we only include ticket-specific identifiers and a short directive.
 */
function buildSlimLocalProtocolSection(
  ticketId: string,
  platformUrl: string,
  context?: PromptContext
): string {
  const baseUrlLabel = context === 'electron' ? 'Connector URL' : 'Base URL';
  const launchNote =
    context === 'electron'
      ? '> **Launched from Overlord desktop.** This terminal already has `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID` set. Use the connector URL below for all protocol calls.'
      : '> **Running locally.** If those environment variables are not already set, export `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID` before using the commands below.';

  return `## Overlord Protocol

- **${baseUrlLabel}:** ${platformUrl}/api/protocol
- **Ticket ID:** ${ticketId}

${launchNote}

Use your installed Overlord local workflow instructions. Start by attaching to this ticket.

\`\`\`bash
npx overlord protocol attach --ticket-id ${ticketId}
\`\`\`
`;
}

function buildResumeCommandWithFlags(
  command: string,
  agent: string,
  agentConfigs?: Record<string, AgentConfig>
): string {
  const flags = agentConfigs?.[agent]?.flags ?? [];
  return flags.length > 0 ? `${command} ${flags.join(' ')}` : command;
}

function buildLocalProtocolSection(
  ticketId: string,
  platformUrl: string,
  agentConfigs?: Record<string, AgentConfig>,
  context?: PromptContext,
  launchMode: PromptLaunchMode = 'run'
): string {
  const baseUrlLabel = context === 'electron' ? 'Connector URL' : 'Base URL';
  const launchNote =
    context === 'electron'
      ? '> **Launched from Overlord desktop.** This terminal already has `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID` set. Use the connector URL below for all protocol calls.'
      : '> **Running locally.** If those environment variables are not already set, export `OVERLORD_URL`, `AGENT_TOKEN`, and `TICKET_ID` before using the commands below.';
  const claudeResumeCommand = buildResumeCommandWithFlags(
    `OVERLORD_URL=${platformUrl} AGENT_TOKEN=<agent-token> TICKET_ID=${ticketId} npx overlord resume claude`,
    'claude',
    agentConfigs
  );
  const codexResumeCommand = buildResumeCommandWithFlags(
    `OVERLORD_URL=${platformUrl} AGENT_TOKEN=<agent-token> TICKET_ID=${ticketId} npx overlord resume codex`,
    'codex',
    agentConfigs
  );
  const eventTypeHelp =
    launchMode === 'ask'
      ? 'Pass `--event-type <type>` to publish a specific activity event (default: `update`). Available event types: `update`, `alert`. Do not post `user_follow_up` events during normal Ask-mode discussion.'
      : 'Pass `--event-type <type>` to publish a specific activity event (default: `update`). Available event types:\n- `update` — standard progress update (default)\n- `user_follow_up` — a message or question from the human user\n- `alert` — surface a warning or non-blocking alert';
  const askModeRule =
    launchMode === 'ask'
      ? '- Do not publish `user_follow_up` activity events for normal Ask-mode conversation turns.\n- Only save notes when the user explicitly asks. Save those notes as artifacts (Markdown files only when requested).\n- Do not implement or change code unless the user explicitly asks for implementation.'
      : "- **If the user sends you a message during your session, immediately publish a `user_follow_up` activity event with the user's message recorded verbatim in the summary before doing anything else.**";

  return `## Overlord Protocol

- **${baseUrlLabel}:** ${platformUrl}/api/protocol
- **Ticket ID:** ${ticketId}

${launchNote}

### 1 — Attach (always first)

\`\`\`bash
npx overlord protocol attach --ticket-id ${ticketId}
\`\`\`

Prints response JSON to stdout. Store \`session.sessionKey\` — required for every subsequent call. Response also includes \`ticket\`, \`history\` (deliver events), \`artifacts\`, and \`sharedState\`.
\`promptContext\` is also returned as a ready-to-use assembled context block.

### 2 — Update (after each meaningful step)

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --ticket-id ${ticketId} --summary "What you did and why." --phase execute
\`\`\`

Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`. Use \`execute\` while working. Add \`--payload-json '{"notifications":[...]}'}\` to surface events in the UI. Use \`--external-url https://...\` when you want Overlord to store a deep link back to the live agent session.

${eventTypeHelp}

#### Change rationales (optional on updates)

Record \`changeRationales\` for meaningful behavioral changes during long-running work. Write the JSON array to a temp file and pass it:

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --ticket-id ${ticketId} \\
  --summary "Added retry logic to API client." --phase execute \\
  --change-rationales-file /tmp/rationales.json
\`\`\`

Or inline for a single rationale:

\`\`\`bash
npx overlord protocol update --session-key <sessionKey> --ticket-id ${ticketId} \\
  --summary "Added retry logic to API client." --phase execute \\
  --change-rationales-json '[{"label":"Add exponential backoff","file_path":"lib/api-client.ts","summary":"Added retry with backoff.","why":"Transient failures caused data loss.","impact":"Requests retry up to 3 times before failing.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

### 4 — Ask (blocking question — stop working after calling)

\`\`\`bash
npx overlord protocol ask --session-key <sessionKey> --ticket-id ${ticketId} --question "Specific question for the PM."
\`\`\`

Ticket moves to \`review\` until a human responds. Do not guess.

### 5 — Context (optional, persist across sessions)

\`\`\`bash
npx overlord protocol read-context --session-key <sessionKey> --ticket-id ${ticketId}
npx overlord protocol write-context --session-key <sessionKey> --ticket-id ${ticketId} --key "descriptive-key" --value '"json-value"'
\`\`\`

### 6 — Human-only blockers

If you are blocked by human-only work, call \`ask\` with a precise blocker description and request that the PM create a follow-up human ticket.

### 7 — Storage artifacts (optional upload/download)

\`\`\`bash
npx overlord protocol artifact-upload-file --session-key <sessionKey> --ticket-id ${ticketId} --file ./spec.pdf --content-type application/pdf
npx overlord protocol artifact-download-url --session-key <sessionKey> --ticket-id ${ticketId} --artifact-id <artifact-id>
\`\`\`

### 8 — Deliver (always last)

\`\`\`bash
npx overlord protocol deliver --session-key <sessionKey> \\
  --ticket-id ${ticketId} \\
  --summary "Narrative: what you did, next steps." \\
  --artifacts-json '[{"type":"file_changes","label":"Files modified","content":"..."},{"type":"next_steps","label":"Next steps","content":"..."}]' \\
  --change-rationales-file /tmp/rationales.json
\`\`\`

Artifact types: \`file_changes\`, \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`.

#### Change rationales (expected on deliver)

Always include \`changeRationales\` when delivering. Write a JSON file with one entry per meaningful file change:

\`\`\`json
[
  {
    "label": "Short reviewer-facing title",
    "file_path": "path/to/file.ts",
    "summary": "What changed.",
    "why": "Why it changed.",
    "impact": "Behavioral or review impact.",
    "hunks": [{ "header": "@@ -10,6 +10,14 @@" }]
  }
]
\`\`\`

Save to a temp file and pass via \`--change-rationales-file\`, or use \`--change-rationales-json\` inline for small payloads. Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

Deliver moves the ticket to \`review\`. Do not call if you used \`ask\` and haven't received an answer.

### 9 — Restart command

Include in your deliver artifacts. If omitted, \`/api/protocol/deliver\` appends one automatically.

\`\`\`bash
${claudeResumeCommand}
# or for Codex:
${codexResumeCommand}
\`\`\`

---

## Rules

- Always attach first; always deliver when done.
- Post at least one update before delivering.
- Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.
- Record \`changeRationales\` only for meaningful behavioral changes. Skip formatting-only noise.
- Prefer 1–5 concise \`changeRationales\` for a typical ticket, each tied to a specific file and diff hunk.
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
${askModeRule}
`;
}

/**
 * Builds an MCP server configuration block for the remote protocol section.
 * Agents that support MCP (Claude Code, etc.) can configure this server to get
 * native tool access to Overlord.
 *
 * Note: This section intentionally avoids embedding concrete token values. Agents
 * should read `AGENT_TOKEN` from their environment when configuring auth.
 */
function buildMcpConfigSection(mcpUrl: string, ticketId: string): string {
  const settingsJson = JSON.stringify(
    {
      mcpServers: {
        overlord: {
          type: 'url',
          url: mcpUrl,
          headers: { authorization: 'Bearer <AGENT_TOKEN>' }
        }
      }
    },
    null,
    2
  );

  return `

**Step 1** — Add to your project's \`.claude/settings.json\` (or global \`~/.claude/settings.json\`):

\`\`\`json
${settingsJson}
\`\`\`

**Step 2** — Available MCP tools:
- \`attach\` — attach to this ticket first (use ticketId: \`${ticketId}\`)
- \`artifact_prepare_upload\` / \`artifact_finalize_upload\` — upload and associate storage artifacts
- \`artifact_get_download_url\` — signed read URL for storage artifacts
- \`update\` — post progress updates
- \`ask\` — ask a blocking question
- \`read_context\` / \`write_context\` — persist findings across sessions
- \`deliver\` — deliver completed work
- \`create_ticket\` — create a follow-up ticket for human work`;
}

function buildRemoteProtocolSection(
  ticketId: string,
  _platformUrl: string,
  options?: PromptOptions,
  launchMode: PromptLaunchMode = 'run'
): string {
  const mcpUrl = options?.mcpUrl;
  const mcpSection = mcpUrl ? buildMcpConfigSection(mcpUrl, ticketId) : '';
  const eventTypeHelp =
    launchMode === 'ask'
      ? 'Optional: `eventType`: "update" | "alert" (do not use `user_follow_up` for normal Ask-mode discussion)'
      : 'Optional: `eventType`: "update" | "user_follow_up" | "alert"';
  const askModeRules =
    launchMode === 'ask'
      ? '- Do not publish `user_follow_up` activity events for normal Ask-mode conversation turns.\n- Only save notes when the user explicitly asks. Save those notes as artifacts (Markdown files only when requested).\n- Do not implement or change code unless the user explicitly asks for implementation.'
      : '- If user sends a message, publish `user_follow_up` event immediately with message verbatim.';

  return `## Overlord Protocol (MCP)

Ticket ID: \`${ticketId}\`

Environment variables:
- \`OVERLORD_MCP_URL\` — MCP endpoint
- \`AGENT_TOKEN\` — bearer token

Always include \`ticketId: "${ticketId}"\` in every MCP tool call.
${mcpSection}

### 1 — attach (always first)

\`\`\`json
${generateAttachPayloadExample(ticketId)}
\`\`\`

### 2 — update (after each meaningful step)

\`\`\`json
${generateUpdatePayloadExample(ticketId)}
\`\`\`

${eventTypeHelp}

### 3 — ask (when blocked)

\`\`\`json
${generateAskPayloadExample(ticketId)}
\`\`\`

### 4 — read_context / write_context (optional)

For persisting findings across sessions.

### 5 — artifact_* (optional)

Upload/download storage artifacts:
- \`artifact_prepare_upload\` — begin upload
- \`artifact_finalize_upload\` — commit upload
- \`artifact_get_download_url\` — get signed URL

### 6 — create_ticket (optional)

Create follow-up ticket for human work.

### 7 — deliver (always last)

\`\`\`json
${generateDeliverPayloadExample(ticketId)}
\`\`\`

### Rules

- Always attach first; always deliver when done.
- Post ≥1 update before delivering.
- Only include \`changeRationales\` for meaningful behavioral changes.
- If blocked, create a follow-up ticket.
${askModeRules}
`;
}
