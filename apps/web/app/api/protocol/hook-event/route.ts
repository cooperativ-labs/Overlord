import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { parseProtocolBody } from '@/app/api/protocol/_lib';
import { isLikelyOverlordAgentLaunchPrompt } from '@/lib/overlord/is-overlord-agent-launch-prompt';
import { resolveTicketId } from '@/lib/overlord/protocol-db';
import { hookEventSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function okResponse() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, hookEventSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { hookType, prompt, ticketId: rawTicketId, turnIndex } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;

    if (hookType === 'UserPromptSubmit' && turnIndex === 0) {
      return okResponse();
    }

    // Both the Claude Code and legacy Cursor hooks send the initial injected ticket/objective
    // prompt as turnIndex 0 (filtered above) but older Cursor builds sent it at turnIndex 1.
    // This catches that legacy case to prevent mis-recording the launch prompt as user_follow_up.
    if (
      hookType === 'UserPromptSubmit' &&
      turnIndex === 1 &&
      prompt &&
      isLikelyOverlordAgentLaunchPrompt(prompt)
    ) {
      return okResponse();
    }

    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) {
      return okResponse();
    }

    const supabase = createServiceRoleClient();

    if (hookType === 'UserPromptSubmit') {
      const summary = prompt?.trim();
      if (!summary) {
        return okResponse();
      }

      const { error } = await supabase.from('ticket_events').insert({
        event_type: 'user_follow_up',
        summary,
        ticket_id: ticketId,
        created_by: userId,
        payload: {
          hook_type: 'UserPromptSubmit',
          turn_index: turnIndex ?? null
        },
        session_id: null
      });

      if (error) {
        console.error('[protocol:hook-event] failed to insert user follow-up:', error);
      }

      return okResponse();
    }

    const { error } = await supabase.from('ticket_events').insert({
      event_type: 'update',
      summary: 'Hook lifecycle event recorded.',
      ticket_id: ticketId,
      created_by: userId,
      payload: {
        hook_type: hookType,
        turn_index: turnIndex ?? null
      },
      session_id: null
    });

    if (error) {
      console.error('[protocol:hook-event] failed to insert hook event:', error);
    }

    return okResponse();
  } catch (error) {
    console.error('[protocol:hook-event] internal error:', error);
    Sentry.captureException(error);
    return okResponse();
  }
}
