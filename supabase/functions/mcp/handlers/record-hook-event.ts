// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolOk } from '../rpc.ts';

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

function normalizeAgentText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\0/g, '');
}

/** Same contract as `lib/overlord/is-overlord-agent-launch-prompt.ts` (kept in sync for Deno). */
function isLikelyOverlordAgentLaunchPrompt(prompt: string): boolean {
  const p = prompt.trim();
  if (p.length < 80) return false;
  if (p.includes('# Overlord Agent Instructions')) return true;
  if (p.includes('You are an AI coding agent working on ticket') && p.includes('## Task')) {
    return true;
  }
  return false;
}

export async function handleRecordHookEvent(
  supabase: SupabaseClient,
  args: any,
  ctx: TokenContext
) {
  const { hookType, prompt, ticketId: rawTicketId, turnIndex } = args;

  if (hookType === 'UserPromptSubmit' && turnIndex === 0) {
    return toolOk({ ok: true });
  }

  // Both the Claude Code and legacy Cursor hooks send the initial injected ticket/objective
  // prompt as turnIndex 0 (filtered above) but older Cursor builds sent it at turnIndex 1.
  // This catches that legacy case to prevent mis-recording the launch prompt as user_follow_up.
  if (
    hookType === 'UserPromptSubmit' &&
    turnIndex === 1 &&
    typeof prompt === 'string' &&
    isLikelyOverlordAgentLaunchPrompt(prompt)
  ) {
    return toolOk({ ok: true });
  }

  const ticketId = await resolveTicketId(supabase, rawTicketId, ctx.organizationId);
  if (!ticketId) {
    return toolOk({ ok: true });
  }

  if (hookType === 'UserPromptSubmit') {
    const summary = typeof prompt === 'string' ? normalizeAgentText(prompt).trim() : '';
    if (!summary) {
      return toolOk({ ok: true });
    }

    const { error } = await supabase.from('ticket_events').insert({
      event_type: 'user_follow_up',
      summary,
      ticket_id: ticketId,
      created_by: ctx.userId,
      payload: {
        hook_type: 'UserPromptSubmit',
        turn_index: typeof turnIndex === 'number' ? turnIndex : null
      },
      objective_id: null
    });

    if (error) return toolOk({ ok: true });
    return toolOk({ ok: true });
  }

  const { error } = await supabase.from('ticket_events').insert({
    event_type: 'update',
    summary: 'Hook lifecycle event recorded.',
    ticket_id: ticketId,
    created_by: ctx.userId,
    payload: {
      hook_type: hookType,
      turn_index: typeof turnIndex === 'number' ? turnIndex : null
    },
    session_id: null
  });

  if (error) return toolOk({ ok: true });
  return toolOk({ ok: true });
}
