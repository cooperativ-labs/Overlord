// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';

export async function handleRecordChangeRationales(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const { sessionKey, ticketId: rawTicketId, summary, phase, changeRationales = [] } = args;
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
      session_id: resolved.session.id,
      summary: eventSummary,
      ticket_id: ticketId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to create event.');

  const rationaleResult = await insertChangeRationales(supabase, {
    changeRationales,
    eventId: event.id,
    sessionId: resolved.session.id,
    ticketId
  });
  if (rationaleResult.error) return toolErr(rationaleResult.error);

  return toolOk({ count: rationaleResult.count, ok: true });
}
