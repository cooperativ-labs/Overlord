import type { InstructionMode } from '@/lib/overlord/agent-capabilities';
import { buildPromptContext, renderPromptContextMarkdown } from '@/lib/overlord/prompt-context';
import {
  generateAskPayloadExample,
  generateAttachPayloadExample,
  generateDeliverPayloadExample,
  generateUpdatePayloadExample
} from '@/lib/overlord/protocol-schema-utils';
import type { AgentConfig } from '@/lib/schemas/agent-config';

export type PromptContext = 'electron' | 'cli' | 'web' | 'paste';
export type PromptLaunchMode = 'run' | 'ask';
export type PromptAgent = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode';

export type PromptOptions = {
  /** Supabase functions base URL for the MCP server, e.g. https://xyz.supabase.co/functions/v1/mcp */
  mcpUrl?: string;
  /** Optional user-level custom instructions to prepend to the prompt */
  customInstructions?: string | null;
  /** Optional working directory to surface in the prompt context. */
  workingDirectory?: string | null;
  /** Launch mode for this prompt. Ask mode guides the agent to ask and stop. */
  launchMode?: PromptLaunchMode;
  /** Optional agent configurations (flags, preferences) keyed by agent type. */
  agentConfigs?: Record<string, AgentConfig>;
  /** Optional target agent so prompt guidance can be specialized. */
  agent?: PromptAgent;
  /** Instruction mode: 'bundle' emits a slim prompt, 'legacy' emits the full protocol walkthrough. */
  instructionMode?: InstructionMode;
  /**
   * When set, replaces the default ## Task body and clears ## History (feed discuss: layered
   * intent → execution → interpretation → question).
   */
  feedDiscussTaskMarkdown?: string;
};

type Ticket = {
  id: string;
  title: string | null | undefined;
  objective: string | null;
  acceptance_criteria: string | null;
  available_tools: string | null;
  constraints?: string | null;
  output_format?: string | null;
  execution_target: 'agent' | 'human' | null;
  project_id: string | null;
  status: string | null;
  priority: string | number | null;
};

type BuildTicketPromptMarkdownInput = {
  ticket: Ticket;
  platformUrl: string;
  context?: PromptContext;
  options?: PromptOptions;
};

type ProtocolSectionInput = {
  ticketId: string;
  context?: PromptContext;
  launchMode: PromptLaunchMode;
  agent?: PromptAgent;
  agentConfigs?: Record<string, AgentConfig>;
  mcpUrl?: string;
};

type LocalProtocolFamily = 'bundled' | 'codex-bundled' | 'codex' | 'verbose';

export function buildTicketPromptMarkdown({
  ticket,
  platformUrl,
  context,
  options
}: BuildTicketPromptMarkdownInput): string {
  const launchMode = options?.launchMode ?? 'run';
  const instructionMode = options?.instructionMode ?? 'legacy';
  const isLocal = context
    ? context === 'electron' || context === 'cli'
    : platformUrl.startsWith('http://localhost') ||
      platformUrl.startsWith('http://127.0.0.1') ||
      platformUrl.startsWith('http://0.0.0.0');

  const built = buildPromptContext({
    ticket,
    customInstructions: options?.customInstructions,
    workingDirectory: options?.workingDirectory,
    launchMode
  });

  let promptContext = built.promptContext;
  if (options?.feedDiscussTaskMarkdown) {
    const sections = { ...built.promptContextSections };
    sections.task = options.feedDiscussTaskMarkdown;
    sections.history = '';
    promptContext = renderPromptContextMarkdown(sections);
  }

  const protocolSection = isLocal
    ? buildLocalProtocolSectionByAgent({
        ticketId: ticket.id,
        context,
        launchMode,
        agent: options?.agent,
        agentConfigs: options?.agentConfigs,
        family: resolveLocalProtocolFamily(options?.agent, instructionMode)
      })
    : buildMcpCloudProtocolSection({
        ticketId: ticket.id,
        launchMode,
        mcpUrl: options?.mcpUrl
      });

  return buildAgentPromptEnvelope({
    title: ticket.title,
    ticketId: ticket.id,
    promptContext,
    protocolSection
  });
}

function buildAgentPromptEnvelope({
  title,
  ticketId,
  promptContext,
  protocolSection
}: {
  title: string | null | undefined;
  ticketId: string;
  promptContext: string;
  protocolSection: string;
}): string {
  return `Title: ${title}
# Overlord Agent Instructions

${buildGeneralAgentInstructions(ticketId)}

${promptContext}
---

${protocolSection}`;
}

function buildGeneralAgentInstructions(ticketId: string): string {
  return `You are an AI coding agent working on ticket **${ticketId}** via Overlord.
Complete the work described below, then deliver a summary back to the platform.`;
}

function resolveLocalProtocolFamily(
  agent: PromptAgent | undefined,
  instructionMode: InstructionMode
): LocalProtocolFamily {
  if (agent === 'codex' && instructionMode === 'bundle') {
    return 'codex-bundled';
  }

  if (agent === 'codex') {
    return 'codex';
  }

  if (
    instructionMode === 'bundle' &&
    (agent === 'claude' || agent === 'cursor' || agent === 'opencode')
  ) {
    return 'bundled';
  }
  return 'verbose';
}

function buildLocalProtocolSectionByAgent(
  input: ProtocolSectionInput & { family: LocalProtocolFamily }
): string {
  if (input.family === 'bundled') {
    return buildBundledLocalProtocolSection(input);
  }
  if (input.family === 'codex-bundled') {
    return buildCodexBundledLocalProtocolSection(input);
  }
  if (input.family === 'codex') {
    return buildCodexLocalProtocolSection(input);
  }
  return buildVerboseLocalProtocolSection(input);
}

function buildBundledLocalProtocolSection({
  ticketId,
  context,
  agent
}: ProtocolSectionInput): string {
  const workflowHint =
    agent === 'cursor'
      ? 'Use the installed Overlord Cursor plugin workflow for this session. Attach first, then follow the plugin skill/rules for update, ask, and deliver behavior.'
      : agent === 'claude'
        ? 'Use the Overlord Claude plugin loaded for this session. Before doing anything else, invoke the `overlord:overlord-ticket` skill for attach/update/ask/deliver details, then attach to this ticket.'
        : agent === 'opencode'
          ? 'Use the installed Overlord OpenCode bundle (AGENTS.md workflow section) for attach/update/ask/deliver details, then attach to this ticket.'
          : 'Use your installed Overlord local workflow configuration for this session. Attach first, then follow the durable workflow instructions for update, ask, and deliver behavior.';

  return `## Overlord Protocol

- **Ticket ID:** ${ticketId}

${buildLocalLaunchNote(context)}

${workflowHint}
Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact.

\`\`\`bash
ovld protocol attach --ticket-id ${ticketId}
\`\`\`
`;
}

function buildCodexBundledLocalProtocolSection({
  ticketId,
  context,
  launchMode
}: ProtocolSectionInput): string {
  const discussionGuidance =
    launchMode === 'ask'
      ? '- This is Ask mode: discuss the ticket, do not implement, and do not publish `user_follow_up` events for normal discussion turns.'
      : '- If the user sends a follow-up message after the initial ticket, immediately publish it with `--event-type user_follow_up` before doing anything else.';

  return `## Overlord Protocol

- **Ticket ID:** ${ticketId}

${buildLocalLaunchNote(context)}

Use the installed Overlord Codex plugin instead of relying on expanded protocol instructions in this prompt.

If you need protocol details, use the \`overlord-ticket\` skill from the Codex Overlord plugin. Attach to this ticket through the plugin/CLI connector, then follow that workflow for updates, blocking questions, change rationales, artifacts, and final delivery.

\`\`\`bash
ovld protocol attach --ticket-id ${ticketId}
\`\`\`

### Rules

- Always attach before writing code or working on the ticket.
- Use the Overlord Codex plugin workflow as the source of truth for protocol details.
${discussionGuidance}
${buildAskModeRules(launchMode)}
`;
}

function buildCodexLocalProtocolSection({
  ticketId,
  context,
  launchMode
}: ProtocolSectionInput): string {
  const eventTypeHelp =
    launchMode === 'ask'
      ? 'Use `--event-type alert` only for non-blocking warnings. Do not publish `user_follow_up` during normal Ask-mode discussion.'
      : 'When the user sends a follow-up message after the initial ticket, immediately publish it with `--event-type user_follow_up` before doing anything else.';

  return `## Overlord Protocol

- **Ticket ID:** ${ticketId}

${buildLocalLaunchNote(context)}

### Codex local workflow

- This local Codex setup uses the Overlord chat plugin and local Codex permission rules.
- For launched ticket work, the authoritative lifecycle is still the \`ovld protocol\` CLI below.
- Do not look for a local \`overlord-local\` skill or Codex \`AGENTS.md\` bundle.

### 1 — Attach first

\`\`\`bash
ovld protocol attach --ticket-id ${ticketId}
\`\`\`

### 2 — Update during work

\`\`\`bash
ovld protocol update --session-key <sessionKey> --ticket-id ${ticketId} --summary "What you did and why." --phase execute
\`\`\`

${eventTypeHelp}

### 3 — Ask when blocked

\`\`\`bash
ovld protocol ask --session-key <sessionKey> --ticket-id ${ticketId} --question "Specific question for the PM."
\`\`\`

### 4 — Deliver last

\`\`\`bash
ovld protocol deliver --session-key <sessionKey> --ticket-id ${ticketId} --payload-file -
\`\`\`

Where the stdin payload contains:

\`\`\`json
{
  "summary": "Narrative: what you did, next steps.",
  "artifacts": [{ "type": "next_steps", "label": "Next steps", "content": "..." }],
  "changeRationales": [{ "label": "Short reviewer-facing title", "file_path": "path/to/file.ts", "summary": "What changed.", "why": "Why it changed.", "impact": "Behavioral or review impact.", "hunks": [{ "header": "@@ -10,6 +10,14 @@" }] }]
}
\`\`\`

Prefer \`--payload-file -\` for large or quote-sensitive delivery payloads so no scratch file needs to be created or removed. If your runtime cannot provide stdin directly, \`--payload-file ./deliver.json\` remains supported; treat that file as ephemeral scratch data, never commit it, and remove it after the deliver call.

### Rules

${buildLocalCoreRules(launchMode)}
`;
}

function buildVerboseLocalProtocolSection({
  ticketId,
  context,
  launchMode,
  agentConfigs
}: ProtocolSectionInput): string {
  const claudeResumeCommand = buildResumeCommandWithFlags(
    `ovld restart claude --ticket-id ${ticketId}`,
    'claude',
    agentConfigs
  );
  const codexResumeCommand = buildResumeCommandWithFlags(
    `ovld restart codex --ticket-id ${ticketId}`,
    'codex',
    agentConfigs
  );
  const opencodeResumeCommand = buildResumeCommandWithFlags(
    `ovld restart opencode --ticket-id ${ticketId}`,
    'opencode',
    agentConfigs
  );

  return `## Overlord Protocol

- **Ticket ID:** ${ticketId}

${buildLocalLaunchNote(context)}

### 1 — Attach (always first)

\`\`\`bash
ovld protocol attach --ticket-id ${ticketId}
\`\`\`

Prints response JSON to stdout. Store \`session.sessionKey\` — required for every subsequent call. Response also includes \`ticket\`, \`history\` (deliver events), \`artifacts\`, and \`sharedState\`.
\`promptContext\` is also returned as a ready-to-use assembled context block.

### 2 — Update (after each meaningful step)

\`\`\`bash
ovld protocol update --session-key <sessionKey> --ticket-id ${ticketId} --summary "What you did and why." --phase execute
\`\`\`

Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`. Use \`execute\` while working. Add \`--payload-json '{"notifications":[...]}'}\` to surface events in the UI. Use \`--external-url https://...\` to store a deep link back to the live agent session. Use \`--external-session-id <id>\` when the agent runtime exposes a native resume/session id.

${buildLocalEventTypeHelp(launchMode)}

#### Change rationales (optional on updates)

Record \`changeRationales\` for meaningful behavioral changes during long-running work. These are structured protocol payloads that Overlord persists as first-class rows in the \`file_changes\` table. Prefer inline JSON or the dedicated rationale command. For larger delivery payloads, prefer \`--payload-file -\` with stdin so no temporary file cleanup is needed. Use file-backed JSON only when stdin is not available, and treat it as ephemeral scratch data rather than a repository file.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id ${ticketId} \\
  --summary "Recorded rationale details for the retry change." --phase execute \\
  --change-rationales-json '[{"label":"Add exponential backoff","file_path":"lib/api-client.ts","summary":"Added retry with backoff.","why":"Transient failures caused data loss.","impact":"Requests retry up to 3 times before failing.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

Or attach them directly to an update:

\`\`\`bash
ovld protocol update --session-key <sessionKey> --ticket-id ${ticketId} \\
  --summary "Added retry logic to API client." --phase execute \\
  --change-rationales-json '[{"label":"Add exponential backoff","file_path":"lib/api-client.ts","summary":"Added retry with backoff.","why":"Transient failures caused data loss.","impact":"Requests retry up to 3 times before failing.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

### 3 — Ask (blocking question — stop working after calling)

\`\`\`bash
ovld protocol ask --session-key <sessionKey> --ticket-id ${ticketId} --question "Specific question for the PM."
\`\`\`

Ticket moves to \`review\` until a human responds. Do not guess.

### 4 — Context (optional, persist across sessions)

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id ${ticketId}
ovld protocol write-context --session-key <sessionKey> --ticket-id ${ticketId} --key "descriptive-key" --value '"json-value"'
\`\`\`

### 5 — Objective attachments (optional upload/download)

The \`attach\` response already lists existing attachments and objective IDs in the \`attachments\` and \`objectives\` arrays (also rendered as the **Attachments** and **Objective IDs** sections of the prompt above). To list mid-session, run \`attachment-list\`.

\`\`\`bash
ovld protocol attachment-list --session-key <sessionKey> --ticket-id ${ticketId}
ovld protocol attachment-upload-file --session-key <sessionKey> --ticket-id ${ticketId} --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --ticket-id ${ticketId} --attachment-id <attachment-id>
\`\`\`

### 6 — Deliver (always last)

\`\`\`bash
ovld protocol deliver --session-key <sessionKey> \\
  --ticket-id ${ticketId} \\
  --summary "Narrative: what you did, next steps." \\
  --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\
  --change-rationales-json '[{"label":"Add exponential backoff","file_path":"lib/api-client.ts","summary":"Added retry with backoff.","why":"Transient failures caused data loss.","impact":"Requests retry up to 3 times before failing.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

For larger or quote-sensitive deliveries, prefer a single JSON payload on stdin and submit it with:

\`\`\`bash
ovld protocol deliver --session-key <sessionKey> --ticket-id ${ticketId} --payload-file -
\`\`\`

Where the stdin payload contains:

\`\`\`json
{
  "summary": "Narrative: what you did, next steps.",
  "artifacts": [{ "type": "next_steps", "label": "Next steps", "content": "..." }],
  "changeRationales": [{ "label": "Short reviewer-facing title", "file_path": "path/to/file.ts", "summary": "What changed.", "why": "Why it changed.", "impact": "Behavioral or review impact.", "hunks": [{ "header": "@@ -10,6 +10,14 @@" }] }]
}
\`\`\`

Prefer stdin for large delivery payloads so no scratch file needs to be created or removed. If your runtime cannot provide stdin directly, \`--payload-file ./deliver.json\` remains supported; treat that file as ephemeral scratch data, never commit it, and remove it after the deliver call.

### 7 — Restart command

Include in your deliver artifacts. If omitted, \`/api/protocol/deliver\` appends one automatically.

\`\`\`bash
${claudeResumeCommand}
# or for Codex:
${codexResumeCommand}
# or for OpenCode:
${opencodeResumeCommand}
\`\`\`

### Rules

${buildLocalCoreRules(launchMode)}
`;
}

function buildMcpConfigSection(mcpUrl: string, ticketId: string): string {
  const settingsJson = JSON.stringify(
    {
      mcpServers: {
        overlord: {
          type: 'url',
          url: mcpUrl
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
- \`discover_project\` — resolve project from a working directory path (same as \`ovld protocol discover-project\`)
- \`search_tickets\` — search or list tickets by keyword and status filters (same as \`ovld protocol search-tickets\`)
- \`list_attachments\` — discover objective attachments (returns attachment IDs needed below)
- \`prepare_attachment_upload\` / \`finalize_attachment_upload\` — upload a file as an objective attachment
- \`get_attachment_download_url\` — signed read URL for an existing attachment (CLI: \`attachment-download-url\`)
- \`update\` — post progress updates
- \`record_change_rationales\` — persist structured change rationales to the \`file_changes\` table
- \`ask\` — ask a blocking question
- \`read_context\` / \`write_context\` — persist findings across sessions
- \`deliver\` — deliver completed work
- \`create_ticket\` — create a follow-up ticket; set \`executionTarget\` to \`"agent"\` for computer-executable work or \`"human"\` for tasks requiring human presence/judgment`;
}

function buildMcpCloudProtocolSection({
  ticketId,
  launchMode,
  mcpUrl
}: ProtocolSectionInput): string {
  const mcpSection = mcpUrl ? buildMcpConfigSection(mcpUrl, ticketId) : '';
  const eventTypeHelp =
    launchMode === 'ask'
      ? 'Optional: `eventType`: "update" | "alert" (do not use `user_follow_up` for normal Ask-mode discussion)'
      : 'Optional: `eventType`: "update" | "user_follow_up" | "alert"';

  return `## Overlord Protocol (MCP)

Ticket ID: \`${ticketId}\`

Environment variables:
- \`OVERLORD_MCP_URL\` — MCP endpoint
- Authenticate with the client's OAuth flow.

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

Use \`changeRationales\` on \`update\` or \`deliver\`, or call \`record_change_rationales\` directly when you want to persist rationale rows separately. Those records are stored in Overlord's \`file_changes\` table.

MCP tool calls accept structured JSON directly. Do not create local delivery JSON files for MCP delivery; the CLI \`--payload-file -\` transport is only for local shell-based \`ovld protocol deliver\` commands.

### 3 — ask (when blocked)

\`\`\`json
${generateAskPayloadExample(ticketId)}
\`\`\`

### 4 — read_context / write_context (optional)

For persisting findings across sessions.

### 5 — attachment tools (optional)

The \`attach\` response includes an \`attachments\` array with the IDs needed below. Call \`list_attachments\` mid-session if new files have been added. Upload/download objective attachments:
- \`list_attachments\` — discover existing attachment + objective IDs
- \`prepare_attachment_upload\` — begin upload
- \`finalize_attachment_upload\` — commit upload
- \`get_attachment_download_url\` — get signed URL using an attachment ID from \`list_attachments\` or the prompt's Attachments section

### 6 — create_ticket (optional)

Create a follow-up ticket. Set \`executionTarget\` to \`"agent"\` for tasks an AI can complete in a computer environment (coding, research, document editing) or \`"human"\` for tasks requiring human presence or judgment (setting credentials in a third-party UI, sending a letter, making a product decision).

### 7 — deliver (always last)

\`\`\`json
${generateDeliverPayloadExample(ticketId)}
\`\`\`

### Rules

${buildMcpCoreRules(launchMode)}
`;
}

function buildLocalLaunchNote(context?: PromptContext): string {
  return context === 'electron'
    ? '> **Launched from Overlord desktop.** This terminal already has the needed Overlord environment. Use `ovld protocol ...` commands for all ticket lifecycle work.'
    : '> **Running locally.** `ovld protocol` uses `OVERLORD_URL` and reads shared credentials from `ovld auth login` or Overlord Desktop. Export env vars only when overriding stored credentials. If auth looks stale or a protocol call returns 401, first run `ovld auth repair` yourself. If repair does not fix it, try `ovld auth login --organization-id <id>` (use the organization ID from the ticket context) or Overlord Desktop if needed.';
}

function buildLocalEventTypeHelp(launchMode: PromptLaunchMode): string {
  return launchMode === 'ask'
    ? 'Pass `--event-type <type>` to publish a specific activity event (default: `update`). Available event types: `update`, `alert`. Do not post `user_follow_up` events during normal Ask-mode discussion.'
    : 'Pass `--event-type <type>` to publish a specific activity event (default: `update`). Available event types:\n- `update` — standard progress update (default)\n- `user_follow_up` — a message or question from the human user\n- `alert` — surface a warning or non-blocking alert';
}

function buildAskModeRules(launchMode: PromptLaunchMode): string {
  return launchMode === 'ask'
    ? '- Do not publish `user_follow_up` activity events for normal Ask-mode conversation turns.\n- **Before doing anything else**, present your current working directory to the user and ask them to confirm it is correct. Do NOT read, write, or modify any files until the user confirms.\n- **You MUST ask the user for explicit confirmation before creating, editing, or deleting any files.** Always present the intended changes and wait for approval.\n- Only save notes when the user explicitly asks. Save those notes as artifacts (Markdown files only when requested).\n- Do not implement or change code unless the user explicitly asks for implementation.'
    : "- **If the user sends you a message during your session, immediately publish a `user_follow_up` activity event with the user's message recorded verbatim in the summary before doing anything else.**";
}

function buildLocalCoreRules(launchMode: PromptLaunchMode): string {
  return `- Always attach first; always deliver when done.
- Post at least one update before delivering.
- Always include \`changeRationales\` when delivering.
- Record \`changeRationales\` only for meaningful behavioral changes. Skip formatting-only noise.
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
- **Do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
- **When creating follow-up tickets, set \`execution_target\` based on who should do the work:**
  - \`agent\` — any task an AI agent can complete in a computer environment (coding, research, document editing, data analysis, etc.)
  - \`human\` — any task requiring human presence or judgment (setting credentials in a third-party UI, sending a letter, making a product or business decision, physical-world actions)
${buildAskModeRules(launchMode)}`;
}

function buildMcpCoreRules(launchMode: PromptLaunchMode): string {
  const askModeRules =
    launchMode === 'ask'
      ? '- Do not publish `user_follow_up` activity events for normal Ask-mode conversation turns.\n- **Before doing anything else**, present your current working directory to the user and ask them to confirm it is correct. Do NOT read, write, or modify any files until the user confirms.\n- **You MUST ask the user for explicit confirmation before creating, editing, or deleting any files.** Always present the intended changes and wait for approval.\n- Only save notes when the user explicitly asks. Save those notes as artifacts (Markdown files only when requested).\n- Do not implement or change code unless the user explicitly asks for implementation.'
      : '- If user sends a message, publish `user_follow_up` event immediately with message verbatim.';

  return `- Always attach first; always deliver when done.
- Post ≥1 update before delivering.
- Only include \`changeRationales\` for meaningful behavioral changes.
- Treat \`changeRationales\` as structured ticket content persisted in the \`file_changes\` table, not as free-form notes.
- If blocked, create a follow-up ticket.
- **Do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
- **When creating follow-up tickets via \`create_ticket\`, set \`executionTarget\` based on who should do the work:**
  - \`"agent"\` — tasks an AI agent can complete in a computer environment (coding, research, document editing, data analysis, etc.)
  - \`"human"\` — tasks requiring human presence or judgment (setting credentials in a third-party UI, sending a letter, making a product decision, physical-world actions)
${askModeRules}`;
}

function buildResumeCommandWithFlags(
  command: string,
  agent: string,
  agentConfigs?: Record<string, AgentConfig>
): string {
  const flags = agentConfigs?.[agent]?.flags ?? [];
  return flags.length > 0 ? `${command} ${flags.join(' ')}` : command;
}
