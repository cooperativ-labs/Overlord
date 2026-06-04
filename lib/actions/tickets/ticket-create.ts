'use server';

import { revalidatePath } from 'next/cache';

import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import {
  getAuthDiagnostics,
  getServerActionRequestDiagnostics,
  idSuffix,
  logElectronServerActionDiagnostic,
  toErrorDiagnostics
} from '@/lib/diagnostics/server-action';
import { normalizeHexColor } from '@/lib/helpers/color';
import { projectNameConflictError } from '@/lib/helpers/project-name';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { upsertDraftObjective } from '@/lib/objectives';
import { createTicketSchema } from '@/lib/overlord/validation';
import { resolveNamedStatus } from '@/lib/ticket-statuses';
import { createClientForRequest } from '@/supabase/utils/server';

import {
  assignTicketToColumnEnd,
  assignTicketToColumnStart,
  resolveAnyTicketStatus,
  resolveNewTicketDraftStatus,
  resolveTicketProjectAndOrganization,
  revalidateTicketBoards,
  revalidateTicketDetails
} from './internals';

export async function createTicketInColumnAction(
  status: string,
  objective: string,
  ticketId: string,
  organizationId?: number,
  projectId?: string | null,
  position: 'top' | 'bottom' = 'top',
  generateTitle = true
) {
  const requestDiagnostics = await getServerActionRequestDiagnostics();
  const supabase = await createClientForRequest();

  if (requestDiagnostics.isElectron) {
    const authDiagnostics = await getAuthDiagnostics(supabase);
    logElectronServerActionDiagnostic('createTicketInColumnAction', 'attempt', {
      auth: authDiagnostics,
      inputOrganizationId: organizationId ?? null,
      inputProjectIdSuffix: idSuffix(projectId),
      request: requestDiagnostics,
      status,
      ticketIdSuffix: idSuffix(ticketId)
    });
  }

  let selected: { organizationId: number; projectId: string | null };
  let normalizedStatus: string | null;
  try {
    selected = await resolveTicketProjectAndOrganization(supabase, {
      organizationId,
      projectId
    });
    normalizedStatus = await resolveNamedStatus(supabase, selected.organizationId, status);
    if (!normalizedStatus) {
      try {
        normalizedStatus = await resolveNewTicketDraftStatus(supabase, selected.organizationId);
      } catch {
        normalizedStatus = await resolveAnyTicketStatus(supabase, selected.organizationId);
      }
    }
  } catch (error) {
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createTicketInColumnAction', 'resolve_context_failed', {
        ...toErrorDiagnostics(error),
        inputOrganizationId: organizationId ?? null,
        inputProjectIdSuffix: idSuffix(projectId),
        request: requestDiagnostics,
        status,
        ticketIdSuffix: idSuffix(ticketId)
      });
    }
    throw error;
  }

  const statusForInsert = normalizedStatus ?? 'draft';
  const trimmedObjective = objective.trim() || null;

  // Generate title: AI-summarised for long objectives, truncated for short ones
  let title: string | null;
  try {
    title =
      generateTitle && trimmedObjective ? await generateTicketTitleAction(trimmedObjective) : null;
  } catch (error) {
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createTicketInColumnAction', 'title_generation_failed', {
        ...toErrorDiagnostics(error),
        organizationId: selected.organizationId,
        projectIdSuffix: idSuffix(selected.projectId),
        request: requestDiagnostics,
        ticketIdSuffix: idSuffix(ticketId)
      });
    }
    throw error;
  }

  const insertPayload: {
    id: string;
    status: string;
    title: string | null;
    organization_id: number;
    project_id: string | null;
  } = {
    id: ticketId,
    status: statusForInsert,
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
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createTicketInColumnAction', 'insert_failed', {
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? 'No ticket row returned.',
        organizationId: selected.organizationId,
        projectIdSuffix: idSuffix(selected.projectId),
        request: requestDiagnostics,
        status: statusForInsert,
        ticketIdSuffix: idSuffix(ticketId)
      });
    }
    throw new Error(error?.message ?? 'Failed to create ticket.');
  }

  let objectiveId: string;
  try {
    objectiveId = await upsertDraftObjective(supabase, data.id, trimmedObjective);
    if (position === 'bottom') {
      await assignTicketToColumnEnd(supabase, data.id, statusForInsert, data.organization_id);
    } else {
      await assignTicketToColumnStart(supabase, data.id, statusForInsert, data.organization_id);
    }
  } catch (error) {
    if (requestDiagnostics.isElectron) {
      logElectronServerActionDiagnostic('createTicketInColumnAction', 'post_insert_failed', {
        ...toErrorDiagnostics(error),
        organizationId: data.organization_id,
        projectIdSuffix: idSuffix(data.project_id),
        request: requestDiagnostics,
        status: statusForInsert,
        ticketIdSuffix: idSuffix(data.id)
      });
    }
    throw error;
  }

  if (requestDiagnostics.isElectron) {
    logElectronServerActionDiagnostic('createTicketInColumnAction', 'created', {
      organizationId: data.organization_id,
      projectIdSuffix: idSuffix(data.project_id),
      request: requestDiagnostics,
      status: statusForInsert,
      ticketIdSuffix: idSuffix(data.id)
    });
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: data.organization_id, projectId: data.project_id })
  );
  revalidateTicketDetails([
    { organizationId: data.organization_id, projectId: data.project_id, ticketId: data.id }
  ]);
  return {
    id: data.id,
    objectiveId,
    organizationId: data.organization_id,
    projectId: data.project_id,
    title
  };
}

export async function createCalendarTicketAction(
  objective: string,
  dueDatetime: string,
  organizationId?: number,
  projectId?: string | null
) {
  const supabase = await createClientForRequest();
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

export async function createBlankTicketAction(organizationId?: number, projectId?: string | null) {
  const supabase = await createClientForRequest();
  const selected = await resolveTicketProjectAndOrganization(supabase, {
    organizationId,
    projectId
  });

  const insertPayload: {
    status: string;
    organization_id: number;
    project_id: string | null;
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
    forHuman: formData.get('forHuman') === 'true'
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid ticket.');
  }

  const supabase = await createClientForRequest();
  const selected = await resolveTicketProjectAndOrganization(supabase, { organizationId });

  const insertPayload: {
    acceptance_criteria: string | null;
    available_tools: string;
    for_human: boolean;
    status: string;
    title: string;
    organization_id: number;
    project_id: string | null;
  } = {
    acceptance_criteria: parsed.data.acceptanceCriteria || null,
    available_tools: parsed.data.availableTools,
    for_human: parsed.data.forHuman,
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
  const supabase = await createClientForRequest();
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
    throw projectNameConflictError(error, 'Failed to create project.');
  }

  revalidateTicketBoards();
  return { id: data.id, name: data.name, color: data.color, everhour_project_id: null };
}
