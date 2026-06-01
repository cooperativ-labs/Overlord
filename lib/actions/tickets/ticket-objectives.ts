'use server';

import { revalidatePath } from 'next/cache';

import { isAppFeatureEnabled } from '@/lib/app-features';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import {
  computePromotedObjectivePositions,
  computeReorderedObjectivePositions,
  persistObjectivePositions,
  promoteNextFutureDraft
} from '@/lib/objectives';
import { failActiveExecutionRequestsForObjective } from '@/lib/overlord/execution-requests';
import { createClientForRequest } from '@/supabase/utils/server';

import { assertTicketAccess, revalidateTicketBoards, revalidateTicketDetails } from './internals';

export async function markObjectiveExecutedAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClientForRequest();
  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id,state,objective,ticket_id,assigned_agent')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .single();

  if (objectiveError || !objective) {
    throw new Error(objectiveError?.message ?? 'Objective not found.');
  }

  if (objective.state === 'complete') {
    return;
  }

  const { error: executeError } = await supabase
    .from('objectives')
    .update({ state: 'complete', completed_at: new Date().toISOString() })
    .eq('id', objectiveId);
  if (executeError) {
    throw new Error(executeError.message);
  }

  const shouldPromoteNextFuture =
    objective.state === 'draft' ||
    objective.state === 'submitted' ||
    objective.state === 'launching';
  if (shouldPromoteNextFuture) {
    const promotedFuture = await promoteNextFutureDraft(supabase, ticketId);

    if (!promotedFuture) {
      const { data: existingDraft, error: existingDraftError } = await supabase
        .from('objectives')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('state', 'draft')
        .limit(1)
        .maybeSingle();
      if (existingDraftError) {
        throw new Error(existingDraftError.message);
      }

      if (!existingDraft) {
        const { error: insertDraftError } = await supabase.from('objectives').insert({
          ticket_id: ticketId,
          objective: '',
          state: 'draft',
          assigned_agent: objective.assigned_agent ?? null
        });
        if (insertDraftError) {
          throw new Error(insertDraftError.message);
        }
      }
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

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    await failActiveExecutionRequestsForObjective({
      supabase,
      organizationId: ticket.organization_id,
      objectiveId,
      requestedBy: user.id
    }).catch(err =>
      console.error('[markObjectiveExecuted] failed to cancel active execution request:', err)
    );
  }
  if (user && objective.objective) {
    const { generateAndSetObjectiveTitle } = await import('@/lib/objectives');
    generateAndSetObjectiveTitle(supabase, objectiveId, objective.objective, user.id).catch(err =>
      console.error('[markObjectiveExecuted] title generation failed:', err)
    );
  }

  await supabase.from('ticket_events').insert({
    event_type: 'update',
    summary: 'Objective marked complete.',
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

export async function markObjectiveDraftAction(
  ticketId: string,
  objectiveId: string
): Promise<void> {
  const supabase = await createClientForRequest();

  const { data: objectives, error: objectivesError } = await supabase
    .from('objectives')
    .select('id,state,objective')
    .eq('ticket_id', ticketId);

  if (objectivesError || !objectives) {
    throw new Error(objectivesError?.message ?? 'Objectives not found.');
  }

  const targetObjective = objectives.find(o => o.id === objectiveId);
  if (!targetObjective) {
    throw new Error('Target objective not found.');
  }

  if (targetObjective.state === 'draft') {
    return;
  }

  const { error: demoteDraftsError } = await supabase
    .from('objectives')
    .update({ state: 'future', completed_at: null })
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .neq('id', objectiveId);

  if (demoteDraftsError) {
    throw new Error(demoteDraftsError.message);
  }

  const { error: unexecuteError } = await supabase
    .from('objectives')
    .update({ state: 'draft', completed_at: null })
    .eq('id', objectiveId);

  if (unexecuteError) {
    throw new Error(unexecuteError.message);
  }

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
    summary: 'Objective marked draft.',
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

export async function updateObjectiveBodyAction({
  ticketId,
  objectiveId,
  body
}: {
  ticketId: string;
  objectiveId: string;
  body: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const { data: row, error: rowError } = await supabase
    .from('objectives')
    .select('id,state')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .maybeSingle();

  if (rowError) {
    throw new Error(rowError.message);
  }
  if (!row) {
    throw new Error('Objective not found.');
  }
  if (
    row.state !== 'draft' &&
    row.state !== 'future' &&
    row.state !== 'submitted' &&
    row.state !== 'launching'
  ) {
    throw new Error('Only draft, future, submitted, or launching objectives can be edited here.');
  }

  const normalized = body.trim();

  if (row.state === 'future' && normalized === '') {
    const { error: deleteError } = await supabase
      .from('objectives')
      .delete()
      .eq('id', objectiveId)
      .eq('ticket_id', ticketId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  } else {
    const { error: updateError } = await supabase
      .from('objectives')
      .update({ objective: normalized })
      .eq('id', objectiveId);

    if (updateError) {
      throw new Error(updateError.message);
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

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function createEmptyDraftObjectiveAction({
  ticketId
}: {
  ticketId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);
  const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');

  const { data: editableObjectives, error: probeError } = await supabase
    .from('objectives')
    .select('id,objective,state,created_at')
    .eq('ticket_id', ticketId)
    .in('state', futureObjectivesEnabled ? ['draft', 'future'] : ['draft'])
    .order('created_at', { ascending: true });

  if (probeError) {
    throw new Error(probeError.message);
  }

  const hasDraft = editableObjectives?.some(objective => objective.state === 'draft') ?? false;
  const lastEditable = editableObjectives?.[editableObjectives.length - 1] ?? null;
  const lastObjectiveText = lastEditable?.objective?.trim() ?? '';

  if (futureObjectivesEnabled) {
    if (hasDraft && lastObjectiveText === '') {
      return;
    }
  } else if (hasDraft) {
    return;
  }

  // Seed the new objective's assigned_agent from the most recently set agent on this ticket
  // so that agent selection is preserved across objectives. ONLY apply on creation — once
  // an agent is set on an objective it should only change if a user or agent explicitly changes it.
  const { data: latestWithAgent } = await supabase
    .from('objectives')
    .select('assigned_agent')
    .eq('ticket_id', ticketId)
    .not('assigned_agent', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newState = futureObjectivesEnabled && hasDraft ? 'future' : 'draft';

  const { error: insertError } = await supabase.from('objectives').insert({
    ticket_id: ticketId,
    state: newState,
    objective: '',
    assigned_agent: latestWithAgent?.assigned_agent ?? null
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function setObjectiveAutoAdvanceAction({
  ticketId,
  objectiveId,
  autoAdvance
}: {
  ticketId: string;
  objectiveId: string;
  autoAdvance: boolean;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);

  const updates: Record<string, unknown> = { auto_advance: autoAdvance };
  if (autoAdvance) {
    updates.approval_reason = null;
  }

  const { error } = await supabase
    .from('objectives')
    .update(updates)
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .in('state', ['draft', 'submitted', 'future', 'launching']);

  if (error) {
    throw new Error(error.message);
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function clearAwaitingApprovalAction({
  ticketId,
  objectiveId
}: {
  ticketId: string;
  objectiveId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);

  await supabase
    .from('objectives')
    .update({ approval_reason: null, auto_advance: true })
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId);

  await supabase
    .from('tickets')
    .update({ has_unopened_waiting_response: false })
    .eq('id', ticketId);

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function reorderFutureObjectivesAction({
  ticketId,
  orderedObjectiveIds
}: {
  ticketId: string;
  orderedObjectiveIds: string[];
}): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);
  const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');

  if (!futureObjectivesEnabled) {
    throw new Error('Future objectives are disabled.');
  }

  if (orderedObjectiveIds.length === 0) {
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from('objectives')
    .select('id,state,position,created_at')
    .eq('ticket_id', ticketId)
    .in('state', ['draft', 'future'])
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (existingError) {
    throw new Error(existingError.message);
  }
  if (!existing) {
    return;
  }
  const validIds = new Set(existing.map(objective => objective.id));
  const filteredOrderedIds = orderedObjectiveIds.filter(id => validIds.has(id));
  const nextPositions = computeReorderedObjectivePositions(existing, filteredOrderedIds);
  await persistObjectivePositions(supabase, ticketId, nextPositions);

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}

export async function promoteFutureObjectiveAction({
  ticketId,
  objectiveId
}: {
  ticketId: string;
  objectiveId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);
  const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');

  if (!futureObjectivesEnabled) {
    throw new Error('Future objectives are disabled.');
  }

  const { data: objectives, error: objectivesError } = await supabase
    .from('objectives')
    .select('id,state,position,created_at')
    .eq('ticket_id', ticketId)
    .in('state', ['draft', 'future'])
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (objectivesError) {
    throw new Error(objectivesError.message);
  }
  const objective = objectives?.find(candidate => candidate.id === objectiveId) ?? null;
  if (!objective) {
    throw new Error('Objective not found.');
  }
  if (objective.state === 'draft') {
    return;
  }
  if (objective.state !== 'future') {
    throw new Error('Only future objectives can be promoted.');
  }

  const nextPositions = computePromotedObjectivePositions(objectives ?? [], objectiveId);

  const { error: demoteDraftsError } = await supabase
    .from('objectives')
    .update({ state: 'future', completed_at: null })
    .eq('ticket_id', ticketId)
    .eq('state', 'draft');

  if (demoteDraftsError) {
    throw new Error(demoteDraftsError.message);
  }

  const { error: promoteError } = await supabase
    .from('objectives')
    .update({ state: 'draft', completed_at: null })
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId);

  if (promoteError) {
    throw new Error(promoteError.message);
  }

  await persistObjectivePositions(supabase, ticketId, nextPositions);

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Future objective promoted to draft.',
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

export async function deleteFutureObjectiveAction({
  ticketId,
  objectiveId
}: {
  ticketId: string;
  objectiveId: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  const ticket = await assertTicketAccess(supabase, ticketId);
  const futureObjectivesEnabled = await isAppFeatureEnabled('future-objectives');

  if (!futureObjectivesEnabled) {
    throw new Error('Future objectives are disabled.');
  }

  const { data: objective, error: objectiveError } = await supabase
    .from('objectives')
    .select('id,state')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .maybeSingle();

  if (objectiveError) {
    throw new Error(objectiveError.message);
  }
  if (!objective) {
    throw new Error('Objective not found.');
  }
  if (objective.state !== 'future') {
    throw new Error('Only future objectives can be deleted here.');
  }

  const { error: deleteError } = await supabase
    .from('objectives')
    .delete()
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  await supabase.from('ticket_events').insert({
    event_type: 'system',
    summary: 'Future objective deleted.',
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

export async function updateObjectiveTitleAction({
  ticketId,
  objectiveId,
  title
}: {
  ticketId: string;
  objectiveId: string;
  title: string;
}): Promise<void> {
  const supabase = await createClientForRequest();
  await assertTicketAccess(supabase, ticketId);

  const { data: row, error: rowError } = await supabase
    .from('objectives')
    .select('id,state')
    .eq('id', objectiveId)
    .eq('ticket_id', ticketId)
    .maybeSingle();

  if (rowError) {
    throw new Error(rowError.message);
  }
  if (!row) {
    throw new Error('Objective not found.');
  }

  const normalized = title.trim();

  const { error: updateError } = await supabase
    .from('objectives')
    .update({ title: normalized || null })
    .eq('id', objectiveId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('organization_id,project_id')
    .eq('id', ticketId)
    .single();

  if (ticketError || !ticket) {
    throw new Error(ticketError?.message ?? 'Ticket not found.');
  }

  revalidateTicketBoards();
  revalidatePath(
    buildProjectPath({ organizationId: ticket.organization_id, projectId: ticket.project_id })
  );
  revalidateTicketDetails([
    { organizationId: ticket.organization_id, projectId: ticket.project_id, ticketId }
  ]);
}
