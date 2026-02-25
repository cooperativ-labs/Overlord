// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleReadContext(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const { sessionKey, ticketId, query = '', limit = 20 } = args;
  const resolved = await resolveSession(supabase, sessionKey, ticketId, ctx.organizationId);
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');

  let q = supabase
    .from('shared_state')
    .select('*')
    .or(`ticket_id.eq.${ticketId},ticket_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (query) q = q.ilike('state_key', `%${query}%`);

  const { data: rows, error } = await q;
  if (error) return toolErr(error.message);

  await supabase.from('ticket_events').insert({
    event_type: 'context_read',
    payload: { query },
    session_id: resolved.session.id,
    summary: query ? `Read context query: ${query}` : 'Read latest context entries.',
    ticket_id: ticketId
  });

  return toolOk({ context: rows ?? [], count: rows?.length ?? 0 });
}
