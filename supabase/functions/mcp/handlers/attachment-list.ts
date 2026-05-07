// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

export async function handleAttachmentList(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const { sessionKey, ticketId, objectiveId } = args;
  if (!sessionKey || !ticketId) {
    return toolErr('sessionKey and ticketId are required.');
  }

  const resolved = await resolveSession(supabase, sessionKey, ticketId, ctx.organizationId);
  if (!resolved.session || !resolved.resolvedTicketId) {
    return toolErr(resolved.error ?? 'Session not found.');
  }

  let query = supabase
    .from('objective_attachments')
    .select('id, label, content_type, file_size, objective_id, storage_path, created_at')
    .eq('ticket_id', resolved.resolvedTicketId)
    .order('created_at', { ascending: false });

  if (objectiveId) {
    query = query.eq('objective_id', String(objectiveId));
  }

  const { data: attachments, error } = await query;
  if (error) {
    return toolErr(error.message ?? 'Failed to list attachments.');
  }

  return toolOk({ ok: true, attachments: attachments ?? [] });
}
