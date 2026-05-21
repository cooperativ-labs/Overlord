import type { SupabaseClient } from '@supabase/supabase-js';

import { createExecutionRequest } from '@/lib/overlord/execution-requests';
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

export async function resolveNextQueuedObjectiveAfterDeliver(
  supabase: ObjectiveClient,
  ticketId: string
): Promise<QueuedObjectiveAfterDeliver | null> {
  return getCurrentDraftWithContent(supabase, ticketId);
}

export type ScheduleQueuedObjectiveAfterDeliverInput = {
  supabase: ObjectiveClient;
  ticketId: string;
  userId: string;
  organizationId: number;
  ticketReference: string;
};

export type ScheduleQueuedObjectiveAfterDeliverResult = { advanced: true } | { advanced: false };

export async function scheduleQueuedObjectiveAfterDeliver({
  supabase,
  ticketId,
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
    await createExecutionRequest(supabase, {
      ticketId,
      objectiveId: nextQueued.id,
      userId,
      organizationId,
      requestedFrom: 'auto_advance',
      idempotencyKey: `auto_advance:${nextQueued.id}`
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
