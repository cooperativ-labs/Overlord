import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { sendPushNotification } from '@/lib/overlord/push-notifications';
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
    const {
      artifacts,
      changeRationales,
      checkpoint,
      sessionKey,
      snapshot,
      summary,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId, userId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const supabase = createServiceRoleClient();
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id,ticket_id,project_id')
      .eq('id', ticketId)
      .maybeSingle();
    const ticketReference = getTicketIdentifier(ticket ?? ticketId);
    const typedSupabase = supabase as SupabaseClient<Database>;
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }
    if ((snapshot?.backend || checkpoint) && !ticket?.project_id) {
      return NextResponse.json(
        { error: 'Cannot persist a checkpoint for a ticket without a project.' },
        { status: 400 }
      );
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
        ticket_id: ticketId,
        created_by: userId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to write delivery event.' },
        { status: 500 }
      );
    }

    let checkpointId: string | null = null;
    if (snapshot?.backend || checkpoint) {
      const { data: objective } = await supabase
        .from('objectives')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('state', 'executing')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: checkpointRow, error: checkpointError } = await supabase
        .from('project_checkpoints')
        .insert({
          organization_id: organizationId,
          project_id: ticket!.project_id!,
          ticket_id: ticketId,
          objective_id: objective?.id ?? null,
          session_id: resolved.session.id,
          event_id: event.id,
          checkpoint_kind: checkpoint?.kind ?? 'delivery',
          backend: snapshot?.backend ?? 'unknown',
          workspace_path: snapshot?.workspacePath ?? null,
          workspace_name: snapshot?.workspaceName ?? null,
          jj_change_id: snapshot?.jjChangeId ?? null,
          jj_commit_id: snapshot?.jjCommitId ?? null,
          jj_operation_id: snapshot?.jjOperationId ?? null,
          git_commit_id: snapshot?.gitCommitId ?? snapshot?.baseGitCommitId ?? null,
          summary: checkpoint?.summary ?? summary,
          diff_stat: checkpoint?.diffStat ?? snapshot?.diffStat ?? null,
          created_by: userId
        })
        .select('id')
        .single();

      if (checkpointError || !checkpointRow) {
        console.error('[protocol:deliver] checkpoint insert error:', checkpointError?.message);
        Sentry.captureException(checkpointError ?? new Error('Failed to write checkpoint.'), {
          extra: { ticketId, sessionId: resolved.session.id, eventId: event.id }
        });
      } else {
        checkpointId = checkpointRow.id;
      }
    }

    if (Array.isArray(changeRationales) && changeRationales.length > 0) {
      const rationaleResult = await insertFileChanges({
        changeRationales,
        checkpointId,
        eventId: event.id,
        sessionId: resolved.session.id,
        snapshot,
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
            uri: artifact.uri ?? null,
            created_by: userId
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
        const completedAt = new Date().toISOString();
        await supabase
          .from('objectives')
          .update({ state: 'complete', completed_at: completedAt })
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
          ticket_id: ticketId,
          created_by: userId
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

        // Send mobile push notification
        await sendPushNotification(supabase, {
          title: `Agent Delivered (${ticketReference})`,
          body: summary || 'The agent delivered this ticket for review.',
          organizationId,
          data: { ticketId, eventType: 'deliver' }
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
      status: reviewStatusName
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
