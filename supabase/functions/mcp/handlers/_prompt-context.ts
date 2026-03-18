// deno-lint-ignore-file no-explicit-any

type TicketLike = {
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

type PromptContextSections = {
  task: string;
  guidance: string;
  history: string;
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

function formatSharedStateLine(item: any): string {
  return `- ${item.state_key}: ${formatJsonInline(item.state_value)}`;
}

export function buildPromptContext(input: {
  ticket: TicketLike;
  recentEvents?: any[];
  history?: any[];
  artifacts?: any[];
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
    sharedState = [],
    customInstructions,
    workingDirectory,
    launchMode = 'run'
  } = input;

  const task = [
    formatTicketMetadata(ticket),
    optionalSubsection('Objective', ticket.objective),
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

  const promptContextSections = {
    task,
    guidance: guidanceLines.join('\n'),
    history: historyParts.join('\n'),
    artifacts: artifacts.map(formatArtifactLine).join('\n'),
    sharedContext: sharedState.map(formatSharedStateLine).join('\n')
  };

  const promptContext = [
    section('Task', promptContextSections.task),
    section('Guidance', promptContextSections.guidance),
    section('History', promptContextSections.history),
    section('Artifacts', promptContextSections.artifacts),
    section('Shared Context', promptContextSections.sharedContext)
  ]
    .filter(Boolean)
    .join('\n\n');

  return { promptContext, promptContextSections };
}
