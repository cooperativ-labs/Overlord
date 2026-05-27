// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';
import { upsertObjectiveCheckpoint } from './_checkpoints.ts';

async function markObjectivePendingDeliveryAfterPriorDelivery(
  supabase: SupabaseClient,
  input: {
    ticketId: string;
    objectiveId: string;
  }
): Promise<string | null> {
  const { data: priorDelivery, error: deliveryError } = await supabase
    .from('ticket_events')
    .select('id')
    .eq('ticket_id', input.ticketId)
    .eq('objective_id', input.objectiveId)
    .eq('event_type', 'deliver')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deliveryError) return deliveryError.message;
  if (!priorDelivery) return null;

  const { error } = await supabase
    .from('objectives')
    .update({ state: 'pending_delivery' })
    .eq('id', input.objectiveId)
    .eq('ticket_id', input.ticketId)
    .in('state', ['executing', 'submitted', 'draft', 'complete']);

  return error?.message ?? null;
}

export async function handleRecordChangeRationales(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    phase,
    changeRationales = [],
    snapshot
  } = args;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  if (!Array.isArray(changeRationales) || changeRationales.length === 0) {
    return toolErr('At least one change rationale is required.');
  }

  const eventSummary =
    typeof summary === 'string' && summary.trim().length > 0
      ? summary.trim()
      : `Recorded ${changeRationales.length} change rationale${changeRationales.length === 1 ? '' : 's'}.`;

  const { data: event, error: eventErr } = await supabase
    .from('ticket_events')
    .insert({
      event_type: 'update',
      payload: {
        change_rationale_count: changeRationales.length,
        entry_type: 'file_changes'
      },
      phase: phase ?? null,
      objective_id: resolved.session.objective_id,
      summary: eventSummary,
      ticket_id: ticketId,
      created_by: ctx.userId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to create event.');

  let checkpointId: string | null = null;
  if (snapshot?.gitCommitId) {
    const { data: ticketProject } = await supabase
      .from('tickets')
      .select('project_id')
      .eq('id', ticketId)
      .eq('organization_id', ctx.organizationId)
      .single();
    const projectId = (ticketProject as { project_id: string | null } | null)?.project_id;
    if (projectId) {
      const result = await upsertObjectiveCheckpoint({
        supabase,
        organizationId: ctx.organizationId,
        projectId,
        ticketId,
        sessionId: resolved.session.id,
        eventId: event.id,
        userId: ctx.userId,
        snapshot,
        checkpoint: { kind: 'objective' },
        fallbackSummary: eventSummary
      });
      if (result.error) return toolErr(result.error);
      checkpointId = result.checkpointId;
    }
  }

  const rationaleResult = await insertChangeRationales(supabase, {
    changeRationales,
    checkpointId,
    eventId: event.id,
    sessionId: resolved.session.id,
    ticketId
  });
  if (rationaleResult.error) return toolErr(rationaleResult.error);

  const pendingDeliveryError = await markObjectivePendingDeliveryAfterPriorDelivery(supabase, {
    ticketId,
    objectiveId: resolved.session.objective_id
  });
  if (pendingDeliveryError) return toolErr(pendingDeliveryError);

  return toolOk({ count: rationaleResult.count, ok: true });
}
