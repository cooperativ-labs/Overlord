// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleAsk(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId: rawTicketId, question, phase, payload = {} } = args;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  await supabase.from('ticket_events').insert({
    event_type: 'question',
    is_blocking: true,
    payload,
    phase: phase ?? 'review',
    objective_id: resolved.session.objective_id,
    summary: question,
    ticket_id: ticketId,
    created_by: ctx.userId
  });

  await supabase
    .from('tickets')
    .update({ status: phase ?? 'review' })
    .eq('id', ticketId);

  return toolOk({ ok: true, status: phase ?? 'review' });
}
