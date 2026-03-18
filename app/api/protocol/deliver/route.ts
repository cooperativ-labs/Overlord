import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getPlatformUrl } from '@/lib/env';
import {
  insertChangeRationales,
  resolveTicketProjectContext
} from '@/lib/overlord/change-rationales';
import { buildResumeCommands, selectRestartSessionCommand } from '@/lib/overlord/launch-commands';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { deliverSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const requestStart = Date.now();
  const contentLength = request.headers.get('content-length') ?? 'unknown';

  const parsed = await parseProtocolBody(request, deliverSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const { artifacts, changeRationales, sessionKey, summary, ticketId: rawTicketId } = parsed.data;
    const { organizationId, tokenValue } = parsed.tokenContext;
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
      const ticketContext = await resolveTicketProjectContext(typedSupabase, ticketId);
      if (!ticketContext) {
        return NextResponse.json(
          { error: 'Failed to resolve ticket project context.' },
          { status: 500 }
        );
      }

      const rationaleResult = await insertChangeRationales({
        changeRationales,
        eventId: event.id,
        organizationId: ticketContext.organization_id,
        projectId: ticketContext.project_id,
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

    const { claudeCode, codex, cursor, gemini, opencode } = buildResumeCommands({
      platformUrl: getPlatformUrl(),
      ticketId,
      token: tokenValue
    });
    const restartCommand = selectRestartSessionCommand(
      resolved.session.agent_identifier,
      {
        claudeCode,
        codex,
        cursor,
        gemini,
        opencode
      },
      resolved.session.external_session_id
    );
    const hasRestartArtifact = artifacts.some(
      artifact => artifact.label.trim().toLowerCase() === 'restart session command'
    );
    const artifactsToPersist = hasRestartArtifact
      ? artifacts
      : [
          ...artifacts,
          {
            type: 'note',
            label: 'Restart session command',
            content: `\`\`\`bash\n${restartCommand}\n\`\`\``,
            uri: undefined,
            metadata: {
              agent_identifier: resolved.session.agent_identifier,
              generated_by: 'protocol_deliver',
              restart_session_command: true
            }
          }
        ];

    const artifactCount = artifactsToPersist.length;
    const eventId = event.id;
    const sessionId = resolved.session.id;
    const agentIdentifier = resolved.session.agent_identifier;

    // Fast-ack: return immediately after persisting the minimal deliver event.
    // Artifact inserts and status updates are deferred via after() so that constrained
    // sandbox runtimes with short request windows receive a timely 200 response.
    after(async () => {
      try {
        if (artifactsToPersist.length) {
          const artifactRows = artifactsToPersist.map(artifact => ({
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
          .eq('status', 'review')
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
              status: 'review',
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
      status: 'review'
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
