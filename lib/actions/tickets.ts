'use server';

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import { fetchProfileCustomInstructions } from '@/lib/actions/profile-settings';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { normalizeHexColor } from '@/lib/helpers/color';
import {
  createTicketAssignedAgent,
  parseTicketAssignedAgent
} from '@/lib/helpers/ticket-assigned-agent';
import { buildProjectPath, buildTicketPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import {
  buildTicketPromptMarkdown,
  type PromptContext,
  type PromptLaunchMode
} from '@/lib/overlord/ticket-prompt';
import { createTicketSchema } from '@/lib/overlord/validation';
import { generateDateFromSchedule } from '@/lib/schedulingEngine';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createClient } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

function revalidateTicketBoards() {
  revalidatePath('/u', 'layout');
  revalidatePath('/projects', 'layout');
}

function revalidateTicketDetails(
  items: Iterable<{ organizationId: number; projectId: string; ticketId: string }>
) {
  for (const { organizationId, projectId, ticketId } of items) {
    revalidatePath(`/u/${ticketId}`);
    revalidatePath(buildTicketPath({ organizationId, projectId, ticketId }));
  }
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

/**
 * Verify the current user has access to a ticket by checking it exists
 * within the user's organization scope. RLS on the tickets table already
 * enforces org membership, so if the query returns nothing, the user
 * either doesn't have access or the ticket doesn't exist.
 */
async function assertTicketAccess(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ organization_id: number; project_id: string }> {
  const { data, error } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (error || !data) {
    throw new Error('Ticket not found or access denied.');
  }

  return data;
}

type TicketScheduleRow = {
  created_at: string;
  days_of_month: number[] | null;
  days_of_week: unknown;
  id: number;
  name: string | null;
  organization_id: number;
  period_interval: number;
  period_type: string;
  start_date: string | null;
  timezone: string;
  weeks_of_month: number[] | null;
};

async function getLatestObjectiveText(supabase: ServerSupabase, ticketId: string) {
  const { data, error } = await supabase
    .from('objectives')
    .select('objective,is_executed')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.objective ?? '';
}

async function resolveStatusType(
  supabase: ServerSupabase,
  organizationId: number,
  status: string
): Promise<TicketStatusType | null> {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('status_type')
    .eq('organization_id', organizationId)
    .eq('name', status)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.status_type ?? null;
}

async function resolveScheduledDuplicateStatus(supabase: ServerSupabase, organizationId: number) {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('name,status_type,position')
    .eq('organization_id', organizationId)
    .eq('status_type', 'draft')
    .order('position', { ascending: true });

  if (error || !data || data.length === 0) {
    throw new Error(error?.message ?? 'No draft ticket status is configured.');
  }

  const nextUpStatus = data.find(status => status.name === 'next-up');
  return nextUpStatus?.name ?? data[0].name;
}

async function resolveNewTicketDraftStatus(supabase: ServerSupabase, organizationId: number) {
  return resolvePreferredStatusNameByType(supabase, organizationId, 'draft');
}

function toEngineSchedule(schedule: TicketScheduleRow) {
  return {
    name: schedule.name,
    periodType: schedule.period_type,
    periodInterval: schedule.period_interval,
    weeksOfMonth: schedule.weeks_of_month,
    daysOfMonth: schedule.days_of_month,
    daysOfWeek: Array.isArray(schedule.days_of_week) ? schedule.days_of_week : undefined,
    timezone: schedule.timezone,
    startDate: schedule.start_date
  };
}

async function createScheduledDuplicateIfNeeded(
  supabase: ServerSupabase,
  ticketId: string
): Promise<Array<{ organizationId: number; projectId: string; ticketId: string }>> {
  const { data: sourceTicket, error: sourceTicketError } = await supabase
    .from('tickets')
    .select(
      'acceptance_criteria,available_tools,constraints,context,delegate,due_datetime,execution_target,id,organization_id,output_format,priority,project_id,schedule_id,title'
    )
    .eq('id', ticketId)
    .single();

  if (sourceTicketError || !sourceTicket) {
    throw new Error(sourceTicketError?.message ?? 'Ticket not found.');
  }

  if (!sourceTicket.schedule_id) {
    return [
      {
        organizationId: sourceTicket.organization_id,
        projectId: sourceTicket.project_id,
        ticketId: sourceTicket.id
      }
    ];
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedule')
    .select(
      'created_at,days_of_month,days_of_week,id,name,organization_id,period_interval,period_type,start_date,timezone,weeks_of_month'
    )
    .eq('id', sourceTicket.schedule_id)
    .single();

  if (scheduleError || !schedule) {
    throw new Error(scheduleError?.message ?? 'Schedule not found.');
  }

  const nextDueDatetime = generateDateFromSchedule({
    schedule: toEngineSchedule(schedule),
    itemDueDatetime: sourceTicket.due_datetime ? new Date(sourceTicket.due_datetime) : undefined
  });
  const nextStatus = await resolveScheduledDuplicateStatus(supabase, sourceTicket.organization_id);
  const objective = await getLatestObjectiveText(supabase, sourceTicket.id);

  const { data: duplicateTicket, error: duplicateTicketError } = await supabase
    .from('tickets')
    .insert({
      acceptance_criteria: sourceTicket.acceptance_criteria,
      available_tools: sourceTicket.available_tools,
      constraints: sourceTicket.constraints,
      context: sourceTicket.context,
      delegate: sourceTicket.delegate,
      due_datetime: nextDueDatetime.toISOString(),
      execution_target: sourceTicket.execution_target,
      organization_id: sourceTicket.organization_id,
      output_format: sourceTicket.output_format,
      priority: sourceTicket.priority,
      project_id: sourceTicket.project_id,
      schedule_id: sourceTicket.schedule_id,
      status: nextStatus,
      title: sourceTicket.title
    })
    .select('id,organization_id,project_id')
    .single();

  if (duplicateTicketError || !duplicateTicket) {
    throw new Error(duplicateTicketError?.message ?? 'Failed to create scheduled duplicate.');
  }

  await upsertDraftObjective(supabase, duplicateTicket.id, objective);
  await assignTicketToColumnEnd(
    supabase,
    duplicateTicket.id,
    nextStatus,
    duplicateTicket.organization_id
  );

  await supabase.from('ticket_events').insert([
    {
      event_type: 'system',
      summary: `Created scheduled follow-up ticket ${duplicateTicket.id}.`,
      payload: {
        createdTicketId: duplicateTicket.id,
        dueDatetime: nextDueDatetime.toISOString(),
        scheduleId: sourceTicket.schedule_id
      },
      ticket_id: sourceTicket.id
    },
    {
      event_type: 'system',
      summary: `Scheduled from completed ticket ${sourceTicket.id}.`,
      payload: {
        sourceTicketId: sourceTicket.id,
        dueDatetime: nextDueDatetime.toISOString(),
        scheduleId: sourceTicket.schedule_id
      },
      ticket_id: duplicateTicket.id
    }
  ]);

  return [
    {
      organizationId: sourceTicket.organization_id,
      projectId: sourceTicket.project_id,
      ticketId: sourceTicket.id
    },
    {
      organizationId: duplicateTicket.organization_id,
      projectId: duplicateTicket.project_id,
      ticketId: duplicateTicket.id
    }
  ];
}

async function updateTicketStatusAndSchedule(
  supabase: ServerSupabase,
  ticketId: string,
  status: string
): Promise<Array<{ organizationId: number; projectId: string; ticketId: string }>> {
  const { data: existingTicket, error: existingTicketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id,status')
    .eq('id', ticketId)
    .single();

  if (existingTicketError || !existingTicket) {
    throw new Error(existingTicketError?.message ?? 'Ticket not found.');
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({ status })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket status.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'status_change',
    phase: status,
    summary: `Status changed to ${status}.`,
    ticket_id: ticketId
  });

  const nextStatusType = await resolveStatusType(supabase, existingTicket.organization_id, status);

  if (nextStatusType !== 'complete' || status.trim().toLowerCase() === 'cancelled') {
    return [
      {
        organizationId: data.organization_id,
        projectId: data.project_id,
        ticketId
      }
    ];
  }

  return createScheduledDuplicateIfNeeded(supabase, ticketId);
}

type PromptTicketSource = {
  ticket: {
    id: string;
    organization_id: number;
    title: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    execution_target: Database['public']['Enums']['ticket_execution_target'] | null;
    project_id: string;
    status: string | null;
    priority: Database['public']['Enums']['ticket_priority'] | null;
  };
  latestObjective: string;
};

async function resolvePromptTicketSource(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ error?: string; source?: PromptTicketSource }> {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, organization_id, title, acceptance_criteria, available_tools, execution_target, project_id, status, priority'
    )
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return { error: error?.message ?? 'Ticket not found.' };
  }

  // Prefer the executing objective; fall back to draft
  const { data: executingObjective } = await supabase
    .from('objectives')
    .select('objective')
    .eq('ticket_id', ticketId)
    .eq('state', 'executing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const currentObjective =
    executingObjective ??
    (
      await supabase
        .from('objectives')
        .select('objective')
        .eq('ticket_id', ticketId)
        .eq('is_executed', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data;

  if (
    !currentObjective ||
    !currentObjective.objective ||
    currentObjective.objective.trim() === ''
  ) {
    return { error: 'No objective found for ticket.' };
  }

  return {
    source: {
      ticket,
      latestObjective: currentObjective.objective
    }
  };
}

async function resolveTicketProjectAndOrganization(
  supabase: ServerSupabase,
  input: {
    organizationId?: number;
    projectId?: string;
  }
): Promise<{ organizationId: number; projectId: string }> {
  const explicitProjectId = input.projectId?.trim() || null;

  if (explicitProjectId) {
    let query = supabase
      .from('projects')
      .select('id,organization_id')
      .eq('id', explicitProjectId)
      .limit(1);
    if (input.organizationId !== undefined) {
      query = query.eq('organization_id', input.organizationId);
    }

    const { data: explicitProject, error: explicitProjectError } = await query.maybeSingle();
    if (explicitProjectError || !explicitProject) {
      throw new Error('Selected project not found.');
    }

    return { organizationId: explicitProject.organization_id, projectId: explicitProject.id };
  }

  const cookieStore = await cookies();
  const defaultProjectId = cookieStore.get(DEFAULT_PROJECT_COOKIE)?.value?.trim() || null;
  if (defaultProjectId) {
    let query = supabase.from('projects').select('id,organization_id').eq('id', defaultProjectId);
    if (input.organizationId !== undefined) {
      query = query.eq('organization_id', input.organizationId);
    }

    const { data: cookieProject, error: cookieProjectError } = await query.maybeSingle();
    if (!cookieProjectError && cookieProject) {
      return { organizationId: cookieProject.organization_id, projectId: cookieProject.id };
    }
  }

  let fallbackQuery = supabase
    .from('projects')
    .select('id,organization_id')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1);
  if (input.organizationId !== undefined) {
    fallbackQuery = fallbackQuery.eq('organization_id', input.organizationId);
  }

  const { data: fallbackProject, error: fallbackError } = await fallbackQuery.maybeSingle();
  if (fallbackError || !fallbackProject) {
    throw new Error('No projects available. Create a project first.');
  }

  return { organizationId: fallbackProject.organization_id, projectId: fallbackProject.id };
}

async function assignTicketToColumnStart(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  status: string,
  organizationId: number
) {
  const { data: headTicket, error: headTicketError } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .neq('id', ticketId)
    .order('board_position', { ascending: true })
    .limit(1);

  if (headTicketError) {
    throw new Error(headTicketError.message);
  }

  const minBoardPosition = headTicket?.[0]?.board_position ?? 0;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ board_position: minBoardPosition - 1 })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function assignTicketToColumnEnd(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  status: string,
  organizationId: number
) {
  const { data: tailTicket, error: tailTicketError } = await supabase
    .from('tickets')
    .select('board_position')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .neq('id', ticketId)
    .order('board_position', { ascending: false })
    .limit(1);

  if (tailTicketError) {
    throw new Error(tailTicketError.message);
  }

  const maxBoardPosition = tailTicket?.[0]?.board_position ?? 0;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({ board_position: maxBoardPosition + 1 })
    .eq('id', ticketId);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function createTicketInColumnAction(
  status: string,
  objective: string,
  ticketId: string,
  organizationId?: number,
  projectId?: string,
  position: 'top' | 'bottom' = 'top'
) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });
  const trimmedObjective = objective.trim() || null;

  // Generate title: AI-summarised for long objectives, truncated for short ones
  const title = trimmedObjective ? await generateTicketTitleAction(trimmedObjective) : null;

  const insertPayload: {
    id: string;
    status: string;
    title: string | null;
    organization_id: number;
    project_id: string;
  } = {
    id: ticketId,
    status,
    title,
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, trimmedObjective);
  if (position === 'bottom') {
    await assignTicketToColumnEnd(supabase, data.id, status, data.organization_id);
  } else {
    await assignTicketToColumnStart(supabase, data.id, status, data.organization_id);
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function createCalendarTicketAction(
  objective: string,
  dueDatetime: string,
  organizationId?: number,
  projectId?: string
) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });
  const trimmedObjective = objective.trim() || null;
  const title = trimmedObjective ? await generateTicketTitleAction(trimmedObjective) : null;

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      status: await resolveNewTicketDraftStatus(supabase, selected.organizationId),
      title,
      due_datetime: dueDatetime,
      organization_id: selected.organizationId,
      project_id: selected.projectId
    })
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, trimmedObjective);

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);

  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function createBlankTicketAction(organizationId?: number, projectId?: string) {
  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });

  const insertPayload: {
    status: string;
    organization_id: number;
    project_id: string;
  } = {
    status: await resolveNewTicketDraftStatus(supabase, selected.organizationId),
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, '');
  await assignTicketToColumnEnd(supabase, data.id, insertPayload.status, data.organization_id);

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function createTicketAction(formData: FormData, organizationId?: number) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('objective') ?? formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    executionTarget: formData.get('executionTarget')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const selected = await resolveTicketProjectAndOrganization(supabase, { organizationId });

  const insertPayload: {
    acceptance_criteria: string | null;
    available_tools: string;
    execution_target: Database['public']['Enums']['ticket_execution_target'];
    status: string;
    title: string;
    organization_id: number;
    project_id: string;
  } = {
    acceptance_criteria: parsed.data.acceptanceCriteria || null,
    available_tools: parsed.data.availableTools,
    execution_target: parsed.data.executionTarget,
    status: await resolveNewTicketDraftStatus(supabase, selected.organizationId),
    title: parsed.data.title || deriveTitleFromObjective(parsed.data.description),
    organization_id: selected.organizationId,
    project_id: selected.projectId
  };

  const { data, error } = await supabase
    .from('tickets')
    .insert(insertPayload)
    .select('id,organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  await upsertDraftObjective(supabase, data.id, parsed.data.description);
  await assignTicketToColumnEnd(supabase, data.id, insertPayload.status, data.organization_id);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket created by PM.',
    ticket_id: data.id
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return { id: data.id, organizationId: data.organization_id, projectId: data.project_id };
}

export async function updateTicketAction(ticketId: string, formData: FormData) {
  const parsed = createTicketSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('objective') ?? formData.get('description'),
    availableTools: formData.get('availableTools'),
    acceptanceCriteria: formData.get('acceptanceCriteria'),
    executionTarget: formData.get('executionTarget')
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tickets')
    .update({
      acceptance_criteria: parsed.data.acceptanceCriteria || null,
      available_tools: parsed.data.availableTools,
      execution_target: parsed.data.executionTarget,
      title: parsed.data.title || null
    })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket.');
  }

  await upsertDraftObjective(supabase, ticketId, parsed.data.description);
  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Ticket updated by PM.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

const editableFields = ['title', 'objective', 'available_tools', 'acceptance_criteria'] as const;
type EditableField = (typeof editableFields)[number];

export async function updateTicketFieldAction(
  ticketId: string,
  field: EditableField,
  value: string
): Promise<void> {
  if (!editableFields.includes(field)) {
    throw new Error('Invalid field.');
  }

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const normalizedValue = value.trim();

  let data: { organization_id: number; project_id: string };

  // For objective field, only update the objectives table
  if (field === 'objective') {
    await upsertDraftObjective(supabase, ticketId, normalizedValue);
    const result = await supabase
      .from('tickets')
      .select('organization_id,project_id')
      .eq('id', ticketId)
      .single();

    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? 'Failed to get ticket details.');
    }
    data = result.data;
  } else {
    // For other fields, update the tickets table
    const ticketUpdatePayload =
      field === 'available_tools'
        ? { available_tools: normalizedValue }
        : { [field]: normalizedValue || null };
    const result = await supabase
      .from('tickets')
      .update(ticketUpdatePayload)
      .eq('id', ticketId)
      .select('organization_id,project_id')
      .single();

    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? 'Failed to update ticket.');
    }
    data = result.data;
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `${field.replace('_', ' ')} updated.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketStatusAction(ticketId: string, status: string): Promise<void> {
  const trimmedStatus = status.trim();
  if (!trimmedStatus) {
    throw new Error('Status is required.');
  }

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);
  const affectedTickets = await updateTicketStatusAndSchedule(supabase, ticketId, trimmedStatus);

  revalidateTicketBoards();
  for (const affectedTicket of affectedTickets) {
    revalidatePath(
      buildProjectPath({
        organizationId: affectedTicket.organizationId,
        projectId: affectedTicket.projectId
      })
    );
  }
  revalidateTicketDetails(affectedTickets);
}

export async function updateTicketPriorityAction(
  ticketId: string,
  priority: Database['public']['Enums']['ticket_priority']
): Promise<void> {
  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ priority })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket priority.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'priority_change',
    phase: priority,
    summary: `Priority changed to ${priority}.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function updateTicketExecutionTargetAction(
  ticketId: string,
  executionTarget: Database['public']['Enums']['ticket_execution_target']
) {
  if (executionTarget !== 'agent' && executionTarget !== 'human') {
    throw new Error('Invalid execution target.');
  }

  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .update({ execution_target: executionTarget })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket execution target.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: `Execution target updated to ${executionTarget}.`,
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function setTicketProjectAction(ticketId: string, projectId: string): Promise<void> {
  const supabase = await createClient();
  const nextProjectId = projectId.trim();
  if (!nextProjectId) {
    throw new Error('Project is required.');
  }

  // assertTicketAccess verifies RLS access; reuse the result as existingTicket
  const existingTicket = await assertTicketAccess(supabase, ticketId);

  if (existingTicket.project_id === nextProjectId) {
    return;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update({
      everhour_task_id: null,
      project_id: nextProjectId
    })
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update ticket project.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Project updated.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId }
  ]);
}

export async function markObjectiveExecutedAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClient();
  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id,is_executed,objective,ticket_id')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .single();

  if (objectiveError || !objective) {
    throw new Error(objectiveError?.message ?? 'Objective not found.');
  }

  if (objective.is_executed) {
    return;
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({ is_executed: true, state: 'executing' })
    .eq('id', objectiveId);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const { data: existingDraft, error: existingDraftError } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('is_executed', false)
    .limit(1)
    .maybeSingle();
  if (existingDraftError) {
    throw new Error(existingDraftError.message);
  }

  if (!existingDraft) {
    const { error: insertDraftError } = await supabase.from('objectives').insert({
      ticket_id: ticketId,
      objective: '',
      is_executed: false,
      state: 'draft'
    });
    if (insertDraftError) {
      throw new Error(insertDraftError.message);
    }
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();
  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  // Fire-and-forget: generate objective title immediately
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user && objective.objective) {
    const { generateAndSetObjectiveTitle } = await import('@/lib/objectives');
    generateAndSetObjectiveTitle(supabase, objectiveId, objective.objective, user.id).catch(err =>
      console.error('[markObjectiveExecuted] title generation failed:', err)
    );
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Objective marked executed.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function markObjectiveUnexecutedAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClient();

  // 1. Get all objectives for this ticket to check conditions
  const { data: objectives, error: objectivesError } = await supabase
    .from('objectives')
    .select('id,is_executed,objective')
    .eq('ticket_id', ticketId);

  if (objectivesError || !objectives) {
    throw new Error(objectivesError?.message ?? 'Objectives not found.');
  }

  const targetObjective = objectives.find(o => o.id === objectiveId);
  if (!targetObjective) {
    throw new Error('Target objective not found.');
  }

  if (!targetObjective.is_executed) {
    return;
  }

  // 2. Check if all OTHER objectives are either executed or empty
  const otherObjectives = objectives.filter(o => o.id !== objectiveId);
  const hasActiveNonEmptyObjective = otherObjectives.some(
    o => !o.is_executed && o.objective.trim().length > 0
  );

  if (hasActiveNonEmptyObjective) {
    throw new Error('Cannot unexecute objective while another objective is active.');
  }

  // 3. Mark any empty unexecuted objectives as executed to keep things clean
  const emptyUnexecutedIds = otherObjectives
    .filter(o => !o.is_executed && o.objective.trim().length === 0)
    .map(o => o.id);

  if (emptyUnexecutedIds.length > 0) {
    const { error: updateError } = await supabase
      .from('objectives')
      .update({ is_executed: true, state: 'complete' })
      .in('id', emptyUnexecutedIds);
    if (updateError) {
      throw new Error(updateError.message);
    }
  }

  // 4. Mark the target objective as unexecuted (back to draft)
  const { error: unexecuteError } = await supabase
    .from('objectives')
    .update({ is_executed: false, state: 'draft' })
    .eq('id', objectiveId);

  if (unexecuteError) {
    throw new Error(unexecuteError.message);
  }

  // 5. Log the event and revalidate
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Objective marked unexecuted.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function createProjectAction(input: {
  organizationId: number;
  name: string;
  color: string;
}) {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Project name is required.');
  }

  const color = normalizeHexColor(input.color);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: input.organizationId,
      name: trimmedName,
      color
    })
    .select('id,name,color,organization_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project.');
  }

  revalidateTicketBoards();
  return { id: data.id, name: data.name, color: data.color, everhour_project_id: null };
}

export async function reorderTicketsAction(
  orderedIds: string[],
  statusChange?: { ticketId: string; newStatus: string }
) {
  const supabase = await createClient();
  const organizationIds = new Set<number>();

  if (orderedIds.length > 0) {
    const { data: affectedTickets, error: affectedTicketsError } = await supabase
      .from('tickets')
      .select('id,organization_id')
      .in('id', orderedIds);

    if (affectedTicketsError) {
      throw new Error(affectedTicketsError.message);
    }

    for (const ticket of affectedTickets ?? []) {
      organizationIds.add(ticket.organization_id);
    }
  }

  // Update positions for all tickets in the list in parallel
  const updateResults = await Promise.all(
    orderedIds.map((id, i) => supabase.from('tickets').update({ board_position: i }).eq('id', id))
  );
  for (const { error } of updateResults) {
    if (error) {
      throw new Error(error.message);
    }
  }

  // If a ticket also changed columns, update its status
  if (statusChange) {
    const affectedTickets = await updateTicketStatusAndSchedule(
      supabase,
      statusChange.ticketId,
      statusChange.newStatus
    );

    for (const affectedTicket of affectedTickets) {
      organizationIds.add(affectedTicket.organizationId);
      revalidatePath(
        buildProjectPath({
          organizationId: affectedTicket.organizationId,
          projectId: affectedTicket.projectId
        })
      );
    }

    revalidateTicketDetails(affectedTickets);
  }

  revalidateTicketBoards();
}

export async function markTicketReadAction(ticketId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: true }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketsReadAction(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: true }).in('id', ticketIds);
  if (error) throw new Error(`Failed to mark tickets as read: ${error.message}`);
  revalidateTicketBoards();
}

export async function markTicketUnreadAction(ticketId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('tickets').update({ is_read: false }).eq('id', ticketId);
  if (error) throw new Error(`Failed to mark ticket as unread: ${error.message}`);
  revalidateTicketBoards();
}

export async function markSessionDisconnectedAction(sessionId: string): Promise<void> {
  const supabase = await createClient();

  // Verify the session exists and the user has access (RLS on agent_sessions)
  const { data: session, error: sessionError } = await supabase
    .from('agent_sessions')
    .select('id')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error('Session not found or access denied.');
  }

  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteTicketAction(
  ticketId: string
): Promise<{ organizationId: number; projectId: string }> {
  const supabase = await createClient();
  await assertTicketAccess(supabase, ticketId);

  const { data, error } = await supabase
    .from('tickets')
    .delete()
    .eq('id', ticketId)
    .select('organization_id,project_id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to delete ticket.');
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id }),
    'layout'
  );
  return { organizationId: data.organization_id, projectId: data.project_id };
}

/** Returns the full LLM prompt for a ticket (for copy-to-clipboard). RLS applies. */
export async function getTicketPromptForCopy(
  ticketId: string,
  launchMode: PromptLaunchMode = 'run',
  context?: PromptContext
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { error, source } = await resolvePromptTicketSource(supabase, ticketId);
  if (error || !source) {
    return { error: error ?? 'Unable to load ticket prompt source.' };
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const platformUrl = getPlatformUrl();
  const customInstructions = user ? await fetchProfileCustomInstructions(supabase, user.id) : null;

  let agentConfigs: Record<string, AgentConfig> = {};
  if (user) {
    try {
      agentConfigs = await getAllAgentConfigsAction();
    } catch (error) {
      console.error('Failed to load agent configs for prompt:', error);
      Sentry.captureException(error);
    }
  }

  let mcpUrl: string | undefined;
  try {
    mcpUrl = getOverlordMcpUrl();
  } catch {
    mcpUrl = undefined;
  }

  const prompt = buildTicketPromptMarkdown({
    ticket: {
      ...source.ticket,
      title: source.ticket.title?.trim(),
      objective: source.latestObjective
    },
    platformUrl,
    context,
    options: {
      mcpUrl,
      customInstructions,
      launchMode,
      agentConfigs
    }
  });
  return { prompt };
}

export async function getTicketDiscussionPromptForCopy(
  ticketId: string
): Promise<{ error?: string; prompt?: string }> {
  const supabase = await createClient();
  const { error, source } = await resolvePromptTicketSource(supabase, ticketId);
  if (error || !source) {
    return { error: error ?? 'Unable to load ticket prompt source.' };
  }

  const ticketReference = `#${source.ticket.id.slice(0, 8)}`;
  const title = source.ticket.title?.trim() || '(Untitled)';
  const executionTarget = source.ticket.execution_target === 'human' ? 'Human' : 'Agent';
  const section = (heading: string, value: string | null) =>
    value?.trim() ? `## ${heading}\n${value.trim()}\n` : '';

  const prompt = `You are helping me discuss an Overlord ticket before implementation. First, consider the following:

Your job is to act as a collaborative exploration partner:
- Start by reading the ticket details carefully.
- Then say exactly: "I understand the ticket. What would you like to discuss?"
- Keep the conversation focused on open-ended exploration: scope, risks, tradeoffs, edge cases, and options.
- Do not implement or change any code unless I explicitly ask you to implement.
- Do not publish user_follow_up activity events for normal discussion turns.
- Only save notes when I explicitly ask. Save them as ticket artifacts, and as Markdown files only when I request Markdown.

## Ticket
- Reference: ${ticketReference}
- ID: ${source.ticket.id}
- Title: ${title}
- Status: ${source.ticket.status ?? 'unknown'}
- Priority: ${source.ticket.priority ?? 'unset'}
- Execution Target: ${executionTarget}
- Project ID: ${source.ticket.project_id}

${section('Objective', source.latestObjective)}${section('Acceptance Criteria', source.ticket.acceptance_criteria)}${section('Available Tools / Constraints', source.ticket.available_tools)}
`;

  return { prompt };
}

const TICKET_BOARD_SELECT =
  'id,title,execution_target,status,priority,assigned_agent,recent_agent,is_read,updated_at,board_position,organization_id,project_id,everhour_task_id,schedule_id,delegate,organization:organizations(name),project:projects(name,color,everhour_project_id)';

type RawBoardTicket = {
  id: string;
  title: string | null;
  execution_target: Database['public']['Enums']['ticket_execution_target'];
  status: string;
  priority: string;
  assigned_agent: Database['public']['Tables']['tickets']['Row']['assigned_agent'];
  recent_agent: string | null;
  is_read: boolean;
  updated_at: string;
  board_position: number;
  organization_id: number;
  project_id: string;
  everhour_task_id: string | null;
  schedule_id: number | null;
  delegate: string | null;
  organization: { name: string } | Array<{ name: string }> | null;
  project:
    | { name: string; color: string; everhour_project_id: string | null }
    | Array<{ name: string; color: string; everhour_project_id: string | null }>
    | null;
};

function mapBoardTicket(raw: RawBoardTicket) {
  const p = Array.isArray(raw.project) ? raw.project[0] : raw.project;
  const org = Array.isArray(raw.organization) ? raw.organization[0] : raw.organization;
  return {
    id: raw.id,
    title: raw.title,
    execution_target: raw.execution_target,
    status: raw.status,
    priority: raw.priority,
    assigned_agent: parseTicketAssignedAgent(raw.assigned_agent),
    recent_agent: raw.recent_agent,
    is_read: raw.is_read,
    updated_at: raw.updated_at,
    board_position: raw.board_position,
    organization_id: raw.organization_id,
    project_id: raw.project_id,
    everhour_task_id: raw.everhour_task_id,
    schedule_id: raw.schedule_id,
    delegate: raw.delegate,
    organization_name: org?.name ?? null,
    project_name: p?.name ?? null,
    project_color: p?.color ?? null,
    project_everhour_project_id: p?.everhour_project_id ?? null,
    agent_session_state: null,
    running_agent: null,
    waiting_for_response_at: null,
    has_unopened_waiting_response: false,
    objectives_executed_count: 0
  };
}

export async function loadMoreTicketsAction({
  status,
  organizationId,
  projectId,
  beforeDate
}: {
  status: string;
  organizationId?: number;
  projectId?: string;
  beforeDate: string;
}): Promise<{ tickets: ReturnType<typeof mapBoardTicket>[] }> {
  const supabase = await createClient();

  let query = supabase
    .from('tickets')
    .select(TICKET_BOARD_SELECT)
    .eq('status', status)
    .lt('updated_at', beforeDate)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (organizationId !== undefined) {
    query = query.eq('organization_id', organizationId);
  }
  if (projectId !== undefined) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return { tickets: ((data ?? []) as RawBoardTicket[]).map(mapBoardTicket) };
}

export async function updateTicketDueDateAction(
  ticketId: string,
  dueDate: string | null
): Promise<void> {
  const supabase = await createClient();
  const ticket = await assertTicketAccess(supabase, ticketId);

  const { error } = await supabase
    .from('tickets')
    .update({ due_datetime: dueDate })
    .eq('id', ticketId);

  if (error) throw new Error(error.message);

  revalidateTicketBoards();
  revalidateTicketDetails([
    {
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    }
  ]);
}

export async function updateTicketAssignedAgentAction(
  ticketId: string,
  selection: AgentModelSelection
): Promise<void> {
  const supabase = await createClient();
  const ticket = await assertTicketAccess(supabase, ticketId);

  const { error } = await supabase
    .from('tickets')
    .update({ assigned_agent: createTicketAssignedAgent(selection) })
    .eq('id', ticketId);

  if (error) throw new Error(error.message);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Assigned agent updated.',
    ticket_id: ticketId
  });

  revalidateTicketBoards();
  revalidateTicketDetails([
    {
      organizationId: ticket.organization_id,
      projectId: ticket.project_id,
      ticketId
    }
  ]);
}
