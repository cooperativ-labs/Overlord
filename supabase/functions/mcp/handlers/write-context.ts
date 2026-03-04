// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleWriteContext(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId: rawTicketId, key, value, tags = [] } = args;
  const resolved = await resolveSession(supabase, sessionKey, rawTicketId, ctx.organizationId);
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  const { data: state, error } = await supabase
    .from('shared_state')
    .insert({
      session_id: resolved.session.id,
      state_key: key,
      state_value: value,
      tags,
      ticket_id: ticketId
    })
    .select('*')
    .single();

  if (error || !state) return toolErr(error?.message ?? 'Failed to write shared state.');

  await supabase.from('ticket_events').insert({
    event_type: 'context_write',
    payload: { key, tags },
    session_id: resolved.session.id,
    summary: `Wrote context key ${key}.`,
    ticket_id: ticketId
  });

  return toolOk({ context: state, ok: true });
}
