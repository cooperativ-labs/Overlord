// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleRequestApprovalGate(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const { sessionKey, ticketId: rawTicketId, reason, objectiveId } = args;
  if (typeof reason !== 'string' || !reason.trim()) {
    return toolErr('reason is required.');
  }

  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  let target: { id: string; auto_advance: boolean | null } | null = null;
  if (objectiveId) {
    const { data } = await supabase
      .from('objectives')
      .select('id, auto_advance')
      .eq('id', objectiveId)
      .eq('ticket_id', ticketId)
      .maybeSingle();
    target = data ?? null;
  } else {
    const { data } = await supabase
      .from('objectives')
      .select('id, auto_advance')
      .eq('ticket_id', ticketId)
      .eq('state', 'future')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    target = data ?? null;
  }

  if (!target) {
    return toolErr('No queued future objective is available to gate.');
  }

  const previousAutoAdvance = target.auto_advance !== false;

  await supabase
    .from('objectives')
    .update({ auto_advance: false, approval_reason: reason })
    .eq('id', target.id);

  await supabase.from('ticket_events').insert({
    event_type: 'update',
    phase: 'execute',
    summary: `Requested approval gate on next objective: ${reason}`,
    session_id: resolved.session.id,
    ticket_id: ticketId,
    objective_id: target.id,
    created_by: ctx.userId
  });

  return toolOk({
    ok: true,
    objectiveId: target.id,
    previousAutoAdvance,
    autoAdvance: false
  });
}
