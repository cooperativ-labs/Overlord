import type { Database, Json } from '@/types/database.types';

type TicketEvent = Database['public']['Tables']['ticket_events']['Row'];
type Artifact = Database['public']['Tables']['artifacts']['Row'];
type SharedState = Database['public']['Tables']['shared_state']['Row'];

export type PromptContextAttachment = {
  id: string;
  label: string;
  content_type: string | null;
  file_size: number | null;
  objective_id: string;
};

export type PromptContextObjective = {
  id: string;
  state: string | null;
  objective: string | null;
  auto_advance?: boolean | null;
};

type TicketLike = {
  id: string;
  title: string | null | undefined;
  objective?: string | null;
  objective_id?: string | null;
  acceptance_criteria: string | null;
  available_tools: string | null;
  constraints?: string | null;
  output_format?: string | null;
  for_human: boolean | null;
  project_id: string | null;
  status: string | null;
  priority: string | number | null;
};

export type PromptContextSections = {
  task: string;
  guidance: string;
  history: string;
  attachments: string;
  artifacts: string;
  sharedContext: string;
};

type BuildPromptContextInput = {
  ticket: TicketLike;
  recentEvents?: TicketEvent[];
  history?: TicketEvent[];
  artifacts?: Artifact[];
  attachments?: PromptContextAttachment[];
  objectives?: PromptContextObjective[];
  sharedState?: SharedState[];
  customInstructions?: string | null;
  workingDirectory?: string | null;
  launchMode?: 'run' | 'ask';
};

function section(heading: string, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `## ${heading}\n\n${trimmed}` : '';
}

function optionalSubsection(heading: string, value: string | null | undefined): string {
  return value?.trim() ? `### ${heading}\n\n${value.trim()}` : '';
}

function formatJsonInline(value: Json): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTicketMetadata(ticket: TicketLike): string {
  const lines = [
    `- **Title:** ${ticket.title?.trim() || '(Untitled)'}`,
    `- **Ticket ID:** ${ticket.id}`,
    ...(ticket.objective_id ? [`- **Objective ID:** ${ticket.objective_id}`] : []),
    `- **Status:** ${ticket.status ?? 'unknown'}`,
    `- **Project:** ${ticket.project_id ?? 'Inbox / private'}`
  ];

  return lines.join('\n');
}

function formatEventLine(event: TicketEvent): string {
  const parts: string[] = [event.event_type];
  if (event.phase) parts.push(event.phase);
  const prefix = parts.join(' / ');
  const summary = event.summary?.trim() || '(no summary)';
  return `- [${prefix}] ${summary}`;
}

function formatArtifactLine(artifact: Artifact): string {
  const location = artifact.uri || artifact.storage_path || 'stored in Overlord';
  return `- ${artifact.label} (${artifact.artifact_type}) — ${location}`;
}

function formatBytes(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

function formatAttachmentLine(attachment: PromptContextAttachment): string {
  const meta = [attachment.content_type, formatBytes(attachment.file_size)]
    .filter(Boolean)
    .join(', ');
  const metaSuffix = meta ? ` (${meta})` : '';
  return `- ${attachment.label}${metaSuffix} — attachment-id: \`${attachment.id}\` | objective-id: \`${attachment.objective_id}\``;
}

function formatSharedStateLine(item: SharedState): string {
  const rendered = formatJsonInline(item.state_value);
  return `- ${item.state_key}: ${rendered}`;
}

export function buildPromptContextSections(input: BuildPromptContextInput): PromptContextSections {
  const {
    ticket,
    recentEvents = [],
    history = [],
    artifacts = [],
    attachments = [],
    objectives = [],
    sharedState = [],
    customInstructions,
    workingDirectory,
    launchMode = 'run'
  } = input;

  const objectiveIdsSubsection =
    objectives.length > 0
      ? `### Objective IDs\n\n${objectives
          .map(o => {
            const text = (o.objective ?? '').trim();
            const preview = text ? ` — ${text.length > 80 ? `${text.slice(0, 77)}...` : text}` : '';
            const stateSuffix = o.state ? ` [${o.state}]` : '';
            const autoAdvanceSuffix =
              o.state === 'future' || o.state === 'draft'
                ? ` auto_advance=${o.auto_advance === false ? 'false' : 'true'}`
                : '';
            return `- \`${o.id}\`${stateSuffix}${autoAdvanceSuffix}${preview}`;
          })
          .join('\n')}`
      : '';

  const hasQueuedFollowUpObjective = objectives.some(
    o => o.state === 'future' || o.state === 'draft'
  );
  const queuedFollowupGuidance = hasQueuedFollowUpObjective
    ? `### Queued follow-up objectives

After you deliver, the platform may automatically launch the current draft
objective (when it has content) or the next future objective in queue order.
Whether it auto-launches depends on the per-objective \`auto_advance\` flag
shown beside each Objective ID. You do NOT need to do anything to trigger the
next one.

If — and ONLY if — the next objective is marked \`auto_advance=true\` but
SHOULD NOT run without human review (because your current work surfaced a
question, risk, or decision a human must make first), call:

\`\`\`
ovld protocol request-approval-gate --session-key <sessionKey> --ticket-id <ticketId> --reason "..."
\`\`\`

This flips the next objective's \`auto_advance\` to false so a human must
approve it before it runs. Use sparingly — the default is to deliver and let
the queue continue.`
    : '';

  const taskParts = [
    formatTicketMetadata(ticket),
    optionalSubsection('Objective', ticket.objective),
    objectiveIdsSubsection,
    queuedFollowupGuidance,
    optionalSubsection('Acceptance Criteria', ticket.acceptance_criteria),
    optionalSubsection('Constraints', ticket.constraints),
    optionalSubsection('Available Tools', ticket.available_tools),
    optionalSubsection('Output Format', ticket.output_format)
  ].filter(Boolean);

  const guidanceLines: string[] = [];
  if (customInstructions?.trim()) {
    guidanceLines.push('### Custom Instructions');
    guidanceLines.push('');
    guidanceLines.push(customInstructions.trim());
  }
  if (workingDirectory?.trim()) {
    if (guidanceLines.length > 0) guidanceLines.push('');
    guidanceLines.push('### Working Directory');
    guidanceLines.push('');
    guidanceLines.push(workingDirectory.trim());
  }
  if (launchMode === 'ask') {
    if (guidanceLines.length > 0) guidanceLines.push('');
    guidanceLines.push('### Ask Mode');
    guidanceLines.push('');
    guidanceLines.push('- Attach first and read the ticket context before responding.');
    guidanceLines.push(
      '- **Before doing anything else**, present your current working directory to the user and ask them to confirm it is correct. Do NOT read, write, or modify any files until the user confirms the directory.'
    );
    guidanceLines.push(
      '- Start with: "I understand the ticket. My current working directory is `<cwd>`. Is this the correct project directory? What would you like to discuss?"'
    );
    guidanceLines.push('- Focus on open-ended exploration of ideas related to the ticket.');
    guidanceLines.push('- Do not change code unless the user explicitly asks for implementation.');
    guidanceLines.push(
      '- **You MUST ask the user for explicit confirmation before creating, editing, or deleting any files.** Always present the intended changes and wait for approval.'
    );
    guidanceLines.push(
      '- If the user explicitly asks to save notes, save them as artifacts (Markdown files only when requested).'
    );
    guidanceLines.push('- Do not publish user_follow_up activity events for normal Ask turns.');
  }

  const recentEventLines = recentEvents
    .filter(event => event.event_type !== 'system' && event.event_type !== 'context_read')
    .map(formatEventLine);
  const deliverHistoryLines = history.map(formatEventLine);

  const historyParts: string[] = [];
  if (recentEventLines.length > 0) {
    historyParts.push('### Recent Activity');
    historyParts.push('');
    historyParts.push(recentEventLines.join('\n'));
  }
  if (deliverHistoryLines.length > 0) {
    if (historyParts.length > 0) historyParts.push('');
    historyParts.push('### Prior Deliveries');
    historyParts.push('');
    historyParts.push(deliverHistoryLines.join('\n'));
  }

  const artifactLines = artifacts.map(formatArtifactLine);
  const sharedStateLines = sharedState.map(formatSharedStateLine);
  const attachmentLines = attachments.map(formatAttachmentLine);

  const attachmentsBody =
    attachmentLines.length > 0
      ? `${attachmentLines.join('\n')}\n\nDownload with: \`ovld protocol attachment-download-url --session-key <sessionKey> --attachment-id <attachment-id>\` (MCP: \`get_attachment_download_url\`).`
      : '';

  return {
    task: taskParts.join('\n\n'),
    guidance: guidanceLines.join('\n'),
    history: historyParts.join('\n'),
    attachments: attachmentsBody,
    artifacts: artifactLines.length > 0 ? artifactLines.join('\n') : '',
    sharedContext: sharedStateLines.length > 0 ? sharedStateLines.join('\n') : ''
  };
}

export function renderPromptContextMarkdown(sections: PromptContextSections): string {
  return [
    section('Task', sections.task),
    section('Guidance', sections.guidance),
    section('History', sections.history),
    section('Attachments', sections.attachments),
    section('Delivery Artifacts', sections.artifacts),
    section('Shared Context', sections.sharedContext)
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPromptContext(input: BuildPromptContextInput): {
  promptContext: string;
  promptContextSections: PromptContextSections;
} {
  const promptContextSections = buildPromptContextSections(input);
  return {
    promptContextSections,
    promptContext: renderPromptContextMarkdown(promptContextSections)
  };
}
