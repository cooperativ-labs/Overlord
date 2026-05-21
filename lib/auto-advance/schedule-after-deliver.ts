import type { SupabaseClient } from '@supabase/supabase-js';

import { sendPushNotification } from '@/lib/overlord/push-notifications';
import type { Database, Json } from '@/types/database.types';

type ObjectiveClient = SupabaseClient<Database>;

export type QueuedObjectiveAfterDeliver = {
  id: string;
  objective: string | null;
  auto_advance: boolean | null;
  approval_reason: string | null;
  assigned_agent: Json | null;
};

export function normalizeQueuedObjectiveText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function selectQueuedObjectiveSource({
  draftObjective,
  futureObjective
}: {
  draftObjective: string | null | undefined;
  futureObjective: string | null | undefined;
}): 'draft' | 'future' | null {
  if (normalizeQueuedObjectiveText(draftObjective)) {
    return 'draft';
  }
  if (normalizeQueuedObjectiveText(futureObjective)) {
    return 'future';
  }
  return null;
}

async function getCurrentDraftWithContent(
  supabase: ObjectiveClient,
  ticketId: string
): Promise<QueuedObjectiveAfterDeliver | null> {
  const { data, error } = await supabase
    .from('objectives')
    .select('id, objective, auto_advance, approval_reason, assigned_agent')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data && normalizeQueuedObjectiveText(data.objective)) {
    return data;
  }
  return null;
}

async function promoteEarliestFutureToDraft(
  supabase: ObjectiveClient,
  ticketId: string
): Promise<boolean> {
  const { data: earliestFuture, error: earliestFutureError } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('state', 'future')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (earliestFutureError) {
    throw new Error(earliestFutureError.message);
  }

  if (!earliestFuture) {
    return false;
  }

  const { error: promoteError } = await supabase
    .from('objectives')
    .update({ state: 'draft', completed_at: null })
    .eq('id', earliestFuture.id);

  if (promoteError) {
    throw new Error(promoteError.message);
  }

  return true;
}

export async function resolveNextQueuedObjectiveAfterDeliver(
  supabase: ObjectiveClient,
  ticketId: string
): Promise<QueuedObjectiveAfterDeliver | null> {
  const existing = await getCurrentDraftWithContent(supabase, ticketId);
  if (existing) return existing;

  const promoted = await promoteEarliestFutureToDraft(supabase, ticketId);
  if (!promoted) return null;

  return getCurrentDraftWithContent(supabase, ticketId);
}

export type ScheduleQueuedObjectiveAfterDeliverInput = {
  supabase: ObjectiveClient;
  ticketId: string;
  sessionId: string;
  userId: string;
  organizationId: number;
  ticketReference: string;
};

export type ScheduleQueuedObjectiveAfterDeliverResult = { advanced: true } | { advanced: false };

export async function scheduleQueuedObjectiveAfterDeliver({
  supabase,
  ticketId,
  sessionId,
  userId,
  organizationId,
  ticketReference
}: ScheduleQueuedObjectiveAfterDeliverInput): Promise<ScheduleQueuedObjectiveAfterDeliverResult> {
  const nextQueued = await resolveNextQueuedObjectiveAfterDeliver(supabase, ticketId);
  if (!nextQueued) {
    return { advanced: false };
  }

  const wantsAutoAdvance = nextQueued.auto_advance !== false;

  if (wantsAutoAdvance) {
    await supabase
      .from('objectives')
      .update({
        state: 'submitted',
        auto_advanced_at: new Date().toISOString()
      })
      .eq('id', nextQueued.id);

    await promoteEarliestFutureToDraft(supabase, ticketId);

    await supabase.from('ticket_events').insert({
      event_type: 'auto_advance',
      phase: 'execute',
      summary: 'Queue advanced to next objective automatically.',
      session_id: sessionId,
      ticket_id: ticketId,
      objective_id: nextQueued.id,
      created_by: userId,
      payload: {
        next_objective_id: nextQueued.id,
        assigned_agent: nextQueued.assigned_agent ?? null
      }
    });
  } else {
    await supabase
      .from('tickets')
      .update({ has_unopened_waiting_response: true, is_read: false })
      .eq('id', ticketId);

    await supabase.from('ticket_events').insert({
      event_type: 'awaiting_approval',
      phase: 'execute',
      summary: nextQueued.approval_reason || 'Queued objective is waiting for your approval.',
      session_id: sessionId,
      ticket_id: ticketId,
      objective_id: nextQueued.id,
      is_blocking: true,
      created_by: userId
    });

    await sendPushNotification(supabase, {
      title: `Awaiting approval (${ticketReference})`,
      body: (nextQueued.approval_reason || 'Queued objective is waiting for your approval.').slice(
        0,
        200
      ),
      organizationId,
      data: { ticketId, eventType: 'awaiting_approval', objectiveId: nextQueued.id }
    });
  }

  return { advanced: true };
}
