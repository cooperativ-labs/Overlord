// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { appToolOk, toolErr } from '../rpc.ts';
import { TICKET_CARD_RESOURCE_URI } from '../ui/ticket-card-resource.ts';

import { buildTicketDraft, resolveProject } from './_ticket-drafts.ts';

export async function handleCreateTicketDraft(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const draft = buildTicketDraft(args);
  if (!draft.description) {
    return toolErr('Conversation context is required to prepare a ticket draft.');
  }

  try {
    const project = await resolveProject(supabase, ctx.organizationId, draft.projectId);
    draft.projectId = project.id;
    draft.projectName = project.name;

    return appToolOk(
      'Prepared a draft ticket. Review the fields in the inline card, edit anything that needs work, then save it to Overlord.',
      {
        draft,
        ticketCard: {
          saveToolName: 'save_ticket_draft',
          resourceUri: TICKET_CARD_RESOURCE_URI
        }
      },
      {
        ui: { resourceUri: TICKET_CARD_RESOURCE_URI },
        'openai/outputTemplate': TICKET_CARD_RESOURCE_URI
      }
    );
  } catch (error) {
    return toolErr(error instanceof Error ? error.message : 'Failed to prepare ticket draft.');
  }
}
