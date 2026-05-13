// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolErr, toolOk } from '../rpc.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKET_ID_REGEX = /^\d+:\d+$/;

async function resolveTicketId(supabase: SupabaseClient, ticketId: string, organizationId: number) {
  if (UUID_REGEX.test(ticketId)) return ticketId;
  if (!TICKET_ID_REGEX.test(ticketId)) return null;

  const { data } = await supabase
    .from('tickets')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('ticket_id', ticketId)
    .limit(2);

  return data?.length === 1 ? data[0].id : null;
}

export async function handleDiscussObjective(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const { ticketId: rawTicketId, objectiveId } = args;
  if (!rawTicketId) return toolErr('ticketId is required.');

  const ticketId = await resolveTicketId(supabase, rawTicketId, ctx.organizationId);
  if (!ticketId) return toolErr('Ticket not found.');

  let draftQuery = supabase
    .from('objectives')
    .select('id, objective, state')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft');

  if (objectiveId) {
    draftQuery = draftQuery.eq('id', objectiveId);
  } else {
    draftQuery = draftQuery.order('created_at', { ascending: false }).limit(1);
  }

  const { data: draft, error: draftError } = await draftQuery.maybeSingle();
  if (draftError) return toolErr(draftError.message);

  if (!draft) {
    return toolOk({ ok: true, didSubmit: false, objectiveId: null });
  }

  const objectiveText = (draft.objective ?? '').trim();
  if (!objectiveText) {
    return toolErr('Objective cannot be empty.');
  }

  const { error: updateError } = await supabase
    .from('objectives')
    .update({ state: 'submitted' })
    .eq('id', draft.id);

  if (updateError) return toolErr(updateError.message);

  return toolOk({ ok: true, didSubmit: true, objectiveId: draft.id });
}
