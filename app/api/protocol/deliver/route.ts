import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { deliverSchema } from '@/lib/overlord/validation';
import { resolvePreferredStatusNameByType } from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const requestStart = Date.now();
  const contentLength = request.headers.get('content-length') ?? 'unknown';

  const parsed = await parseProtocolBody(request, deliverSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { artifacts, changeRationales, sessionKey, summary, ticketId: rawTicketId } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const typedSupabase = supabase as SupabaseClient<Database>;
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    // Persist the deliver event synchronously — required before returning so that
    // the event ID is available for artifact foreign keys in the background job.
    const { data: event, error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: 'deliver',
        phase: 'deliver',
        session_id: resolved.session.id,
        summary,
        ticket_id: ticketId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to write delivery event.' },
        { status: 500 }
      );
    }

    if (Array.isArray(changeRationales) && changeRationales.length > 0) {
      const rationaleResult = await insertFileChanges({
        changeRationales,
        eventId: event.id,
        sessionId: resolved.session.id,
        supabase: typedSupabase,
        ticketId
      });

      if (rationaleResult.error) {
        console.error('[protocol:deliver] change rationale insert error:', rationaleResult.error);
        Sentry.captureException(new Error(rationaleResult.error), {
          extra: { ticketId, sessionId: resolved.session.id, eventId: event.id }
        });
        // Non-fatal: continue with delivery even if rationale insertion fails
      }
    }

    const artifactCount = artifacts.length;
    const eventId = event.id;
    const sessionId = resolved.session.id;
    const agentIdentifier = resolved.session.agent_identifier;
    const reviewStatusName = await resolvePreferredStatusNameByType(
      supabase,
      organizationId,
      'review'
    );

    // Fast-ack: return immediately after persisting the minimal deliver event.
    // Artifact inserts and status updates are deferred via after() so that constrained
    // sandbox runtimes with short request windows receive a timely 200 response.
    after(async () => {
      try {
        if (artifacts.length) {
          const artifactRows = artifacts.map(artifact => ({
            artifact_type: artifact.type,
            content: artifact.content ?? null,
            event_id: eventId,
            label: artifact.label,
            metadata: artifact.metadata,
            session_id: sessionId,
            ticket_id: ticketId,
            uri: artifact.uri ?? null
          }));
          const { error: artifactError } = await supabase.from('artifacts').insert(artifactRows);
          if (artifactError) {
            console.error('[protocol:deliver] artifact insert error:', artifactError.message);
            Sentry.captureException(artifactError, {
              extra: { ticketId, sessionId, eventId }
            });
          }
        }

        // Place delivered ticket at the top of the review column
        const { data: headTickets } = await supabase
          .from('tickets')
          .select('board_position')
          .eq('organization_id', organizationId)
          .eq('status', reviewStatusName)
          .neq('id', ticketId)
          .order('board_position', { ascending: true })
          .limit(1);
        const topBoardPosition = (headTickets?.[0]?.board_position ?? 0) - 1;

        const [{ error: ticketError }, { error: sessionError }] = await Promise.all([
          supabase
            .from('tickets')
            .update({
              is_read: false,
              recent_agent: agentIdentifier,
              status: reviewStatusName,
              board_position: topBoardPosition
            })
            .eq('id', ticketId),
          supabase
            .from('agent_sessions')
            .update({
              detached_at: new Date().toISOString(),
              session_state: 'completed'
            })
            .eq('id', sessionId)
        ]);

        // Mark the executing objective as complete
        await supabase
          .from('objectives')
          .update({ state: 'complete' })
          .eq('ticket_id', ticketId)
          .eq('state', 'executing');

        if (ticketError) {
          console.error('[protocol:deliver] ticket update error:', ticketError.message);
          Sentry.captureException(ticketError, { extra: { ticketId } });
        }
        if (sessionError) {
          console.error('[protocol:deliver] session update error:', sessionError.message);
          Sentry.captureException(sessionError, { extra: { sessionId } });
        }

        // Emit status_change event so KanbanBoard realtime listener triggers
        // the review sound and highlights has_unopened_review for agent deliveries.
        await supabase.from('ticket_events').insert({
          event_type: 'status_change',
          phase: 'review',
          summary: 'Ticket delivered and moved to review.',
          session_id: sessionId,
          ticket_id: ticketId
        });

        // Generate feed post (fire-and-forget — non-fatal if it fails)
        try {
          await supabase.functions.invoke('generate-feed-post', {
            body: { ticketId, sessionId, organizationId }
          });
        } catch (feedErr) {
          console.error('[protocol:deliver] feed post generation error:', feedErr);
          Sentry.captureException(feedErr, { extra: { ticketId, sessionId } });
        }
      } catch (bgErr) {
        console.error('[protocol:deliver] background job error:', bgErr);
        Sentry.captureException(bgErr, { extra: { ticketId, sessionId } });
      }
    });

    const durationMs = Date.now() - requestStart;
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        endpoint: '/api/protocol/deliver',
        method: 'POST',
        ticketId,
        contentLength,
        status: 200,
        durationMs
      })
    );

    return NextResponse.json({
      artifacts: artifactCount,
      ok: true,
      status: reviewStatusName
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
