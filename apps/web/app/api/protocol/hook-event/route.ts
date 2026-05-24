import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { parseProtocolBody } from '@/app/api/protocol/_lib';
import { checkDeliveryStatus } from '@/lib/overlord/follow-up-delivery';
import { isLikelyOverlordAgentLaunchPrompt } from '@/lib/overlord/is-overlord-agent-launch-prompt';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { hookEventSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function okResponse() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, hookEventSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      followUpIntent,
      hookType,
      prompt,
      sessionKey,
      ticketId: rawTicketId,
      turnIndex
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const promptLength = prompt?.trim().length ?? 0;

    console.warn('[protocol:hook-event] received hook event', {
      hookType,
      rawTicketId,
      turnIndex: turnIndex ?? null,
      organizationId,
      userId,
      promptLength
    });

    if (hookType === 'UserPromptSubmit' && turnIndex === 0) {
      console.warn('[protocol:hook-event] skipping initial submit event', {
        rawTicketId,
        turnIndex
      });
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
      console.warn('[protocol:hook-event] skipping legacy launch prompt submit', {
        rawTicketId,
        turnIndex,
        promptLength
      });
      return okResponse();
    }

    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) {
      console.warn('[protocol:hook-event] could not resolve ticket id', {
        rawTicketId,
        organizationId
      });
      return okResponse();
    }

    const supabase = createServiceRoleClient();

    if (hookType === 'UserPromptSubmit') {
      const summary = prompt?.trim();
      if (!summary) {
        console.warn('[protocol:hook-event] skipping empty submit prompt', {
          ticketId,
          turnIndex: turnIndex ?? null
        });
        return okResponse();
      }

      const { error } = await supabase.from('ticket_events').insert({
        event_type: 'user_follow_up',
        summary,
        ticket_id: ticketId,
        created_by: userId,
        payload: {
          follow_up_intent: followUpIntent ?? 'discussion',
          hook_type: 'UserPromptSubmit',
          turn_index: turnIndex ?? null
        },
        objective_id: null
      });

      if (error) {
        console.error('[protocol:hook-event] failed to insert user follow-up:', error);
      } else {
        console.warn('[protocol:hook-event] inserted user follow-up event', {
          ticketId,
          turnIndex: turnIndex ?? null,
          promptLength
        });
      }

      return okResponse();
    }

    if (hookType === 'Stop' && sessionKey) {
      const sessionResult = await resolveSession(sessionKey, ticketId, organizationId);
      if (sessionResult.session) {
        const deliveryStatus = await checkDeliveryStatus({ supabase, ticketId });

        console.warn('[protocol:hook-event] stop hook delivery check', {
          ticketId,
          deliveryNeeded: deliveryStatus.needed,
          signals: deliveryStatus.signals
        });

        return NextResponse.json({ ok: true, deliveryStatus });
      }
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
      objective_id: null
    });

    if (error) {
      console.error('[protocol:hook-event] failed to insert hook event:', error);
    } else {
      console.warn('[protocol:hook-event] inserted non-submit hook event', {
        ticketId,
        hookType,
        turnIndex: turnIndex ?? null
      });
    }

    return NextResponse.json({ ok: true, deliveryStatus: null });
  } catch (error) {
    console.error('[protocol:hook-event] internal error:', error);
    Sentry.captureException(error);
    return okResponse();
  }
}
