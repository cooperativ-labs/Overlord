// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { appToolOk, toolErr } from '../rpc.ts';

import { buildTicketDraft, createDraftTicket } from './_ticket-drafts.ts';

export async function handleSaveTicketDraft(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const draft = buildTicketDraft(args);
  if (!draft.description) {
    return toolErr('Description is required before saving this ticket.');
  }

  try {
    const ticket = await createDraftTicket(supabase, ctx, draft);
    return appToolOk(
      `Saved ticket ${ticket.reference} to Overlord.`,
      { ticket, saved: true },
      { savedTicketId: ticket.id }
    );
  } catch (error) {
    return toolErr(error instanceof Error ? error.message : 'Failed to save ticket draft.');
  }
}
