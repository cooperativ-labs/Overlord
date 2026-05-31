'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { upsertDraftObjective } from '@/lib/objectives';
import { generateDateFromSchedule } from '@/lib/schedulingEngine';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createClientForRequest, getRequestDefaultProjectId } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

export type ServerSupabase = Awaited<ReturnType<typeof createClientForRequest>>;
export type TicketStatusType = Database['public']['Enums']['ticket_status_type'];
type TicketPositionSupabase = SupabaseClient<Database>;

export type TicketScheduleRow = {
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

export async function revalidateTicketBoards() {
  revalidatePath('/u', 'layout');
  revalidatePath('/projects', 'layout');
}

export async function revalidateTicketDetails(
  items: Iterable<{ organizationId: number; projectId: string | null; ticketId: string }>
) {
  for (const { organizationId, projectId, ticketId } of items) {
    revalidatePath(`/u/${ticketId}`);
    if (projectId) {
      revalidatePath(buildTicketPath({ organizationId, projectId, ticketId }));
    }
  }
}

export async function assertTicketAccess(
  supabase: ServerSupabase,
  ticketId: string
): Promise<{ organization_id: number; project_id: string | null }> {
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

export async function getLatestObjectiveText(supabase: ServerSupabase, ticketId: string) {
  const { data, error } = await supabase
    .from('objectives')
    .select('objective')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.objective ?? '';
}

export async function resolveStatusType(
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

export async function resolveScheduledDuplicateStatus(
  supabase: ServerSupabase,
  organizationId: number
) {
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

export async function resolveNewTicketDraftStatus(
  supabase: ServerSupabase,
  organizationId: number
) {
  return resolvePreferredStatusNameByType(supabase, organizationId, 'draft');
}

export async function resolveAnyTicketStatus(supabase: ServerSupabase, organizationId: number) {
  const { data, error } = await supabase
    .from('ticket_statuses')
    .select('name')
    .eq('organization_id', organizationId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.name) {
    throw new Error('No ticket status is configured.');
  }

  return data.name;
}

export async function toEngineSchedule(schedule: TicketScheduleRow) {
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

export async function createScheduledDuplicateIfNeeded(
  supabase: ServerSupabase,
  ticketId: string
): Promise<Array<{ organizationId: number; projectId: string | null; ticketId: string }>> {
  const { data: sourceTicket, error: sourceTicketError } = await supabase
    .from('tickets')
    .select(
      'acceptance_criteria,available_tools,constraints,context,delegate,due_datetime,for_human,id,organization_id,output_format,priority,project_id,schedule_id,title'
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
    schedule: await toEngineSchedule(schedule),
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
      for_human: sourceTicket.for_human,
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

export async function updateTicketStatusAndSchedule(
  supabase: ServerSupabase,
  ticketId: string,
  status: string,
  options?: {
    createdBy?: string;
    objectiveId?: string | null;
  }
): Promise<Array<{ organizationId: number; projectId: string | null; ticketId: string }>> {
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

  const statusChanged = existingTicket.status !== status;

  if (statusChanged) {
    await assignTicketToColumnStart(supabase, ticketId, status, existingTicket.organization_id);

    await supabase.from('ticket_events').insert({
      event_type: 'status_change',
      phase: status,
      objective_id: options?.objectiveId ?? undefined,
      summary: `Status changed to ${status}.`,
      ticket_id: ticketId,
      created_by: options?.createdBy
    });
  }

  const nextStatusType = await resolveStatusType(supabase, existingTicket.organization_id, status);

  if (
    !statusChanged ||
    nextStatusType !== 'complete' ||
    status.trim().toLowerCase() === 'cancelled'
  ) {
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

export type PromptTicketSource = {
  ticket: {
    id: string;
    organization_id: number;
    title: string | null;
    acceptance_criteria: string | null;
    available_tools: string | null;
    for_human: boolean | null;
    project_id: string | null;
    status: string | null;
    priority: Database['public']['Enums']['ticket_priority'] | null;
  };
  latestObjectiveId: string | null;
  latestObjective: string;
};

export async function resolvePromptTicketSource(
  supabase: ServerSupabase,
  ticketId: string,
  opts?: { preferredObjectiveId?: string | null }
): Promise<{ error?: string; source?: PromptTicketSource }> {
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      'id, organization_id, title, acceptance_criteria, available_tools, for_human, project_id, status, priority'
    )
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return { error: error?.message ?? 'Ticket not found.' };
  }

  if (opts?.preferredObjectiveId) {
    const { data: preferredRow, error: preferredError } = await supabase
      .from('objectives')
      .select('id, objective')
      .eq('ticket_id', ticketId)
      .eq('id', opts.preferredObjectiveId)
      .maybeSingle();

    if (preferredError) {
      return { error: preferredError.message };
    }

    if (preferredRow?.objective && preferredRow.objective.trim().length > 0) {
      return {
        source: {
          ticket,
          latestObjectiveId: preferredRow.id,
          latestObjective: preferredRow.objective
        }
      };
    }
  }

  // Prefer the executing objective; fall back to the latest submitted objective.
  // Draft objectives are intentionally private to the human until submitted,
  // but we still fall back to them for older databases that do not accept
  // the submitted state yet.
  const { data: executingObjective } = await supabase
    .from('objectives')
    .select('id, objective')
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
        .select('id, objective')
        .eq('ticket_id', ticketId)
        .in('state', ['launching', 'submitted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data ??
    (
      await supabase
        .from('objectives')
        .select('id, objective')
        .eq('ticket_id', ticketId)
        .eq('state', 'draft')
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
      latestObjectiveId: currentObjective.id ?? null,
      latestObjective: currentObjective.objective
    }
  };
}

export async function resolveTicketProjectAndOrganization(
  supabase: ServerSupabase,
  input: {
    organizationId?: number;
    projectId?: string | null;
  }
): Promise<{ organizationId: number; projectId: string | null }> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const { data: profileSettings } = user
    ? await supabase.from('profiles').select('default_project_id').eq('id', user.id).maybeSingle()
    : { data: null };
  const defaultProjectId = await getRequestDefaultProjectId({
    profileDefaultProjectId: profileSettings?.default_project_id ?? null
  });

  if (input.projectId === null) {
    if (input.organizationId !== undefined) {
      return { organizationId: input.organizationId, projectId: null };
    }

    if (defaultProjectId) {
      const { data: cookieProject, error: cookieProjectError } = await supabase
        .from('projects')
        .select('organization_id')
        .eq('id', defaultProjectId)
        .maybeSingle();

      if (!cookieProjectError && cookieProject) {
        return { organizationId: cookieProject.organization_id, projectId: null };
      }
    }

    const { data: fallbackProject, error: fallbackError } = await supabase
      .from('projects')
      .select('organization_id')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fallbackError || !fallbackProject) {
      throw new Error('No projects available. Create a project first.');
    }

    return { organizationId: fallbackProject.organization_id, projectId: null };
  }

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

export async function assignTicketToColumnStart(
  supabase: TicketPositionSupabase,
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

export async function assignTicketToColumnEnd(
  supabase: TicketPositionSupabase,
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
