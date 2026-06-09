import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { parseProtocolBody } from '@/app/api/protocol/_lib';
import { checkDeliveryStatus } from '@/lib/overlord/follow-up-delivery';
import { isLikelyOverlordAgentLaunchPrompt } from '@/lib/overlord/is-overlord-agent-launch-prompt';
import { normalizeExternalSessionId } from '@/lib/overlord/protocol-connect';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { hookEventSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function okResponse() {
  return NextResponse.json({ ok: true });
}

async function persistHookExternalSessionId(input: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  ticketId: string;
  organizationId: number;
  sessionKey?: string;
  externalSessionId?: string | null;
}) {
  const { externalSessionId, organizationId, sessionKey, supabase, ticketId } = input;
  if (!sessionKey || externalSessionId === undefined) return;

  const sessionResult = await resolveSession(sessionKey, ticketId, organizationId);
  if (!sessionResult.session) {
    console.warn('[protocol:hook-event] could not resolve session for external session id update', {
      ticketId,
      sessionKeyPrefix: sessionKey.slice(0, 8)
    });
    return;
  }

  const { error } = await supabase
    .from('agent_sessions')
    .update({ external_session_id: normalizeExternalSessionId(externalSessionId) })
    .eq('id', sessionResult.session.id);

  if (error) {
    console.warn('[protocol:hook-event] failed to persist external session id', {
      ticketId,
      sessionId: sessionResult.session.id,
      error: error.message
    });
  }
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, hookEventSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      externalSessionId,
      followUpIntent,
      hookType,
      prompt,
      sessionKey,
      ticketId: rawTicketId,
      turnIndex
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const promptLength = prompt?.trim().length ?? 0;
    const shouldSkipInitialSubmit = hookType === 'UserPromptSubmit' && turnIndex === 0;
    // A prompt matching the Overlord bootstrap markers is the injected ticket
    // spec, never a human follow-up — so skip it regardless of turnIndex. The
    // turn counter is fragile when an agent session id is reused across tickets
    // (common with AgentPod), which would otherwise mis-record the launch prompt
    // as a user_follow_up at turnIndex > 0. See ticket 1:1430.
    const shouldSkipLaunchPrompt =
      hookType === 'UserPromptSubmit' && !!prompt && isLikelyOverlordAgentLaunchPrompt(prompt);

    console.warn('[protocol:hook-event] received hook event', {
      hookType,
      rawTicketId,
      turnIndex: turnIndex ?? null,
      organizationId,
      userId,
      promptLength
    });

    if (shouldSkipInitialSubmit) {
      console.warn('[protocol:hook-event] skipping initial submit event', {
        rawTicketId,
        turnIndex
      });
    }

    // Catches the injected launch prompt at any turnIndex (including the legacy
    // Cursor turnIndex 1 and the AgentPod context-file prompt) so it is never
    // mis-recorded as user_follow_up.
    if (shouldSkipLaunchPrompt) {
      console.warn('[protocol:hook-event] skipping launch prompt submit', {
        rawTicketId,
        turnIndex,
        promptLength
      });
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
    await persistHookExternalSessionId({
      supabase,
      ticketId,
      organizationId,
      sessionKey,
      externalSessionId
    });

    if (shouldSkipInitialSubmit || shouldSkipLaunchPrompt) {
      return okResponse();
    }

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
