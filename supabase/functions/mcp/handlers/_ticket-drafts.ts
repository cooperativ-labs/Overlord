// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';

import { resolvePreferredStatusNameByType } from './_status-resolution.ts';

const PRIORITY_ORDER = ['low', 'medium', 'high', 'urgent'] as const;

export const DEFAULT_EXECUTION_TARGET = 'agent';

export type TicketDraft = {
  title: string;
  description: string;
  priority: (typeof PRIORITY_ORDER)[number];
  projectId: string | null;
  projectName: string | null;
  sourceSummary: string;
};

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTicketIntentPhrases(value: string) {
  return value
    .replace(/\bturn this into a ticket\b/gi, '')
    .replace(/\bmake (?:this|it) a ticket\b/gi, '')
    .replace(/\bcreate (?:an?|this) ticket\b/gi, '')
    .replace(/\bfile (?:an?|this) ticket\b/gi, '')
    .trim();
}

function deriveTitleFromDescription(description: string) {
  const normalized = normalizeWhitespace(description);
  if (!normalized) return 'Untitled ticket';

  const firstLine = normalized
    .split('\n')
    .map(line => line.replace(/^[-*#>\d.)\s]+/, '').trim())
    .find(Boolean);

  if (!firstLine) return 'Untitled ticket';

  const sentence = firstLine.split(/[.!?](?:\s|$)/)[0]?.trim() || firstLine;
  return clampText(sentence, 80);
}

function inferPriorityFromText(value: string): (typeof PRIORITY_ORDER)[number] {
  const text = value.toLowerCase();

  if (/\b(p0|urgent|critical|sev(?:erity)?[- ]?0|blocker|immediately|asap)\b/.test(text)) {
    return 'urgent';
  }

  if (/\b(p1|high priority|important|soon|customer impact|production)\b/.test(text)) {
    return 'high';
  }

  if (/\b(p3|low priority|backlog|nice to have|someday|whenever)\b/.test(text)) {
    return 'low';
  }

  return 'medium';
}

function getPriority(value: unknown, fallbackText: string): (typeof PRIORITY_ORDER)[number] {
  if (
    typeof value === 'string' &&
    PRIORITY_ORDER.includes(value as (typeof PRIORITY_ORDER)[number])
  ) {
    return value as (typeof PRIORITY_ORDER)[number];
  }

  return inferPriorityFromText(fallbackText);
}

function getDescription(args: any) {
  const explicitDescription =
    typeof args.description === 'string'
      ? args.description
      : typeof args.objective === 'string'
        ? args.objective
        : '';
  const conversationContext =
    typeof args.conversationContext === 'string' ? args.conversationContext : '';
  const combined =
    explicitDescription.trim() ||
    stripTicketIntentPhrases(conversationContext)
      .split('\n')
      .filter(line => !/^\s*(user|assistant|system)\s*:/i.test(line))
      .join('\n');

  return normalizeWhitespace(combined);
}

function getSourceSummary(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return clampText(compact, 220);
}

export function buildTicketDraft(args: any): TicketDraft {
  const description = getDescription(args);
  const title =
    typeof args.title === 'string' && args.title.trim()
      ? clampText(args.title.trim(), 120)
      : deriveTitleFromDescription(description);

  return {
    title,
    description,
    priority: getPriority(args.priority, `${title}\n${description}`),
    projectId:
      typeof args.projectId === 'string' && args.projectId.trim() ? args.projectId.trim() : null,
    projectName: null,
    sourceSummary: getSourceSummary(description)
  };
}

export async function resolveProject(
  supabase: SupabaseClient,
  organizationId: number,
  explicitProjectId: string | null
) {
  if (explicitProjectId) {
    const { data: explicitProject, error: explicitProjectError } = await supabase
      .from('projects')
      .select('id, name, organization_id')
      .eq('id', explicitProjectId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (explicitProjectError) {
      throw new Error(explicitProjectError.message);
    }

    if (!explicitProject) {
      throw new Error('Selected project not found.');
    }

    return explicitProject;
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, organization_id')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectError) {
    throw new Error(projectError.message);
  }

  if (!project) {
    throw new Error('No projects are available for this organization.');
  }

  return project;
}

async function assignTicketToDraftColumnEnd(
  supabase: SupabaseClient,
  organizationId: number,
  ticketId: string,
  draftStatusName: string
) {
  const { data: tailTicket, error: tailTicketError } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', draftStatusName)
    .neq('id', ticketId)
    .order('board_position', { ascending: false })
    .limit(1);

  if (tailTicketError) {
    throw new Error(tailTicketError.message);
  }

  const maxBoardPosition =
    ((tailTicket as { board_position: number }[] | null)?.[0]?.board_position ?? 0) + 1;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ board_position: maxBoardPosition })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function createDraftTicket(
  supabase: SupabaseClient,
  ctx: TokenContext,
  draft: TicketDraft
) {
  const project = await resolveProject(supabase, ctx.organizationId, draft.projectId);
  const draftStatusName = await resolvePreferredStatusNameByType(
    supabase,
    project.organization_id,
    'draft'
  );

  const { data: createdTicket, error: createTicketError } = await supabase
    .from('tickets')
    .insert({
      created_by: ctx.userId,
      execution_target: DEFAULT_EXECUTION_TARGET,
      organization_id: project.organization_id,
      priority: draft.priority,
      project_id: project.id,
      status: draftStatusName,
      title: draft.title
    })
    .select('id, organization_id, project_id, execution_target, status, title')
    .single();

  if (createTicketError || !createdTicket) {
    throw new Error(createTicketError?.message ?? 'Failed to create ticket.');
  }

  const { error: objectiveError } = await supabase.from('objectives').insert({
    is_executed: false,
    state: 'draft',
    objective: draft.description,
    ticket_id: createdTicket.id
  });

  if (objectiveError) {
    throw new Error(objectiveError.message);
  }

  await assignTicketToDraftColumnEnd(
    supabase,
    project.organization_id,
    createdTicket.id,
    draftStatusName
  );

  const ticketReference = createdTicket.id.slice(-8);
  const { error: eventError } = await supabase.from('ticket_events').insert({
    event_type: 'system',
    payload: {
      created_via: 'mcp.save_ticket_draft',
      source_summary: draft.sourceSummary
    },
    summary: `Ticket ${ticketReference} created from interactive MCP draft.`,
    ticket_id: createdTicket.id
  });

  if (eventError) {
    throw new Error(eventError.message);
  }

  return {
    id: createdTicket.id,
    organizationId: createdTicket.organization_id,
    projectId: createdTicket.project_id,
    projectName: project.name,
    reference: ticketReference,
    status: createdTicket.status,
    title: createdTicket.title ?? draft.title,
    executionTarget: createdTicket.execution_target
  };
}
