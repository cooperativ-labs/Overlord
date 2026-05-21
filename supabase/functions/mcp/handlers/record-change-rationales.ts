// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';
import { upsertObjectiveCheckpoint } from './_checkpoints.ts';

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

  return toolOk({ count: rationaleResult.count, ok: true });
}
