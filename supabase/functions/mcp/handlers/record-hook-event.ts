// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

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

/** Mirror of `normalizeExternalSessionId` in `lib/overlord/protocol-connect.ts` (kept in sync for Deno). */
function normalizeExternalSessionId(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
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
  const {
    externalSessionId,
    followUpIntent,
    hookType,
    prompt,
    sessionKey,
    ticketId: rawTicketId,
    turnIndex
  } = args;
  const shouldSkipInitialSubmit = hookType === 'UserPromptSubmit' && turnIndex === 0;
  const shouldSkipLegacyLaunchPrompt =
    hookType === 'UserPromptSubmit' &&
    turnIndex === 1 &&
    typeof prompt === 'string' &&
    isLikelyOverlordAgentLaunchPrompt(prompt);

  const ticketId = await resolveTicketId(supabase, rawTicketId, ctx.organizationId);
  if (!ticketId) {
    return toolOk({ ok: true });
  }

  // Persist the native agent session id even for the initial/launch submits we skip below,
  // so a resume id captured on turn 0 still lands on the session.
  if (typeof sessionKey === 'string' && sessionKey && externalSessionId !== undefined) {
    const resolved = await resolveSession(supabase, sessionKey, ticketId, ctx.organizationId);
    if (resolved.session) {
      await supabase
        .from('agent_sessions')
        .update({ external_session_id: normalizeExternalSessionId(externalSessionId) })
        .eq('id', resolved.session.id);
    }
  }

  // Both the Claude Code and legacy Cursor hooks send the initial injected ticket/objective
  // prompt as turnIndex 0 but older Cursor builds sent it at turnIndex 1. This catches both
  // cases to prevent mis-recording the launch prompt as user_follow_up.
  if (shouldSkipInitialSubmit || shouldSkipLegacyLaunchPrompt) {
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
        follow_up_intent: followUpIntent ?? 'discussion',
        hook_type: 'UserPromptSubmit',
        turn_index: typeof turnIndex === 'number' ? turnIndex : null
      },
      objective_id: null
    });

    if (error) return toolOk({ ok: true });
    return toolOk({ ok: true });
  }

  if (hookType === 'Stop' && typeof sessionKey === 'string' && sessionKey) {
    const { data: session } = await supabase
      .from('agent_sessions')
      .select('id, objective:objectives!inner(ticket_id)')
      .eq('session_key', sessionKey)
      .eq('objective.ticket_id', ticketId)
      .maybeSingle();

    if (session) {
      const { data: objective } = await supabase
        .from('objectives')
        .select('id, state')
        .eq('ticket_id', ticketId)
        .in('state', ['executing', 'pending_delivery'])
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();

      const needed = objective?.state === 'pending_delivery';
      const signals: string[] = [];

      if (needed) {
        signals.push('objective_pending_delivery');

        const { count } = await supabase
          .from('file_changes')
          .select('id', { count: 'exact', head: true })
          .eq('ticket_id', ticketId);

        if (count && count > 0) signals.push('change_rationales_recorded');
      }

      return toolOk({
        ok: true,
        deliveryStatus: {
          needed,
          reason: needed ? 'This session has pending work that should be delivered.' : null,
          signals
        }
      });
    }
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
  return toolOk({ ok: true, deliveryStatus: null });
}
