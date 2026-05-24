// deno-lint-ignore-file no-explicit-any

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
  project_id: string;
  status: string | null;
  priority: string | number | null;
};

type PromptContextSections = {
  task: string;
  guidance: string;
  history: string;
  attachments: string;
  artifacts: string;
  sharedContext: string;
};

function section(heading: string, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `## ${heading}\n\n${trimmed}` : '';
}

function optionalSubsection(heading: string, value: string | null | undefined): string {
  return value?.trim() ? `### ${heading}\n\n${value.trim()}` : '';
}

function formatJsonInline(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTicketMetadata(ticket: TicketLike): string {
  return [
    `- **Title:** ${ticket.title?.trim() || '(Untitled)'}`,
    `- **Ticket ID:** ${ticket.id}`,
    ...(ticket.objective_id ? [`- **Objective ID:** ${ticket.objective_id}`] : []),
    `- **Status:** ${ticket.status ?? 'unknown'}`,
    `- **Project ID:** ${ticket.project_id}`
  ].join('\n');
}

function formatEventLine(event: any): string {
  const parts = [event.event_type];
  if (event.phase) parts.push(event.phase);
  return `- [${parts.join(' / ')}] ${event.summary?.trim() || '(no summary)'}`;
}

function formatArtifactLine(artifact: any): string {
  const location = artifact.uri || artifact.storage_path || 'stored in Overlord';
  return `- ${artifact.label} (${artifact.artifact_type}) — ${location}`;
}

function formatBytes(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

function formatAttachmentLine(attachment: any): string {
  const meta = [attachment.content_type, formatBytes(attachment.file_size)]
    .filter(Boolean)
    .join(', ');
  const metaSuffix = meta ? ` (${meta})` : '';
  return `- ${attachment.label}${metaSuffix} — attachment-id: \`${attachment.id}\` | objective-id: \`${attachment.objective_id}\``;
}

function formatSharedStateLine(item: any): string {
  return `- ${item.state_key}: ${formatJsonInline(item.state_value)}`;
}

export function buildPromptContext(input: {
  ticket: TicketLike;
  recentEvents?: any[];
  history?: any[];
  artifacts?: any[];
  attachments?: any[];
  objectives?: any[];
  sharedState?: any[];
  customInstructions?: string | null;
  workingDirectory?: string | null;
  launchMode?: 'run' | 'ask';
}): {
  promptContext: string;
  promptContextSections: PromptContextSections;
} {
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
          .map((o: any) => {
            const text = String(o.objective ?? '').trim();
            const preview = text ? ` — ${text.length > 80 ? `${text.slice(0, 77)}...` : text}` : '';
            const stateSuffix = o.state ? ` [${o.state}]` : '';
            return `- \`${o.id}\`${stateSuffix}${preview}`;
          })
          .join('\n')}`
      : '';

  const task = [
    formatTicketMetadata(ticket),
    optionalSubsection('Objective', ticket.objective),
    objectiveIdsSubsection,
    optionalSubsection('Acceptance Criteria', ticket.acceptance_criteria),
    optionalSubsection('Constraints', ticket.constraints),
    optionalSubsection('Available Tools', ticket.available_tools),
    optionalSubsection('Output Format', ticket.output_format)
  ]
    .filter(Boolean)
    .join('\n\n');

  const guidanceLines: string[] = [];
  if (customInstructions?.trim()) {
    guidanceLines.push('### Custom Instructions', '', customInstructions.trim());
  }
  if (workingDirectory?.trim()) {
    if (guidanceLines.length > 0) guidanceLines.push('');
    guidanceLines.push('### Working Directory', '', workingDirectory.trim());
  }
  if (launchMode === 'ask') {
    if (guidanceLines.length > 0) guidanceLines.push('');
    guidanceLines.push(
      '### Ask Mode',
      '',
      '- Attach first and read the ticket context.',
      '- Ask one focused blocking question.',
      '- Stop after asking. Do not implement or deliver.'
    );
  }

  const recentEventLines = recentEvents
    .filter(event => event.event_type !== 'system' && event.event_type !== 'context_read')
    .map(formatEventLine);
  const deliverHistoryLines = history.map(formatEventLine);

  const historyParts: string[] = [];
  if (recentEventLines.length > 0) {
    historyParts.push('### Recent Activity', '', recentEventLines.join('\n'));
  }
  if (deliverHistoryLines.length > 0) {
    if (historyParts.length > 0) historyParts.push('');
    historyParts.push('### Prior Deliveries', '', deliverHistoryLines.join('\n'));
  }

  const attachmentLines = attachments.map(formatAttachmentLine);
  const attachmentsBody =
    attachmentLines.length > 0
      ? `${attachmentLines.join('\n')}\n\nDownload via the \`get_attachment_download_url\` MCP tool (or \`ovld protocol attachment-download-url --attachment-id <id>\`).`
      : '';

  const promptContextSections = {
    task,
    guidance: guidanceLines.join('\n'),
    history: historyParts.join('\n'),
    attachments: attachmentsBody,
    artifacts: artifacts.map(formatArtifactLine).join('\n'),
    sharedContext: sharedState.map(formatSharedStateLine).join('\n')
  };

  const promptContext = [
    section('Task', promptContextSections.task),
    section('Guidance', promptContextSections.guidance),
    section('History', promptContextSections.history),
    section('Attachments', promptContextSections.attachments),
    section('Delivery Artifacts', promptContextSections.artifacts),
    section('Shared Context', promptContextSections.sharedContext)
  ]
    .filter(Boolean)
    .join('\n\n');

  return { promptContext, promptContextSections };
}
