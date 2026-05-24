import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { scheduleQueuedObjectiveAfterDeliver } from '@/lib/auto-advance/schedule-after-deliver';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { upsertObjectiveCheckpoint } from '@/lib/overlord/checkpoints';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { emitWorkflowNotification } from '@/lib/overlord/notifications/orchestrator';
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
      .select('id,ticket_id,project_id,title')
      .eq('id', ticketId)
      .maybeSingle();
    const ticketReference = getTicketIdentifier(ticket ?? ticketId);
    const typedSupabase = supabase as SupabaseClient<Database>;
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }
    const hasCheckpoint = Boolean(snapshot?.gitCommitId || checkpoint);
    if (hasCheckpoint && !ticket?.project_id) {
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
        objective_id: resolved.session.objective_id,
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
    if (hasCheckpoint) {
      const result = await upsertObjectiveCheckpoint({
        supabase: typedSupabase,
        organizationId,
        projectId: ticket!.project_id!,
        ticketId,
        sessionId: resolved.session.id,
        eventId: event.id,
        userId,
        snapshot,
        checkpoint: checkpoint
          ? { ...checkpoint, kind: checkpoint.kind ?? 'delivery' }
          : { kind: 'delivery' },
        fallbackSummary: summary
      });
      if (result.error) {
        console.error('[protocol:deliver] checkpoint insert error:', result.error);
        Sentry.captureException(new Error(result.error), {
          extra: { ticketId, sessionId: resolved.session.id, eventId: event.id }
        });
      }
      checkpointId = result.checkpointId;
    }

    if (Array.isArray(changeRationales) && changeRationales.length > 0) {
      const rationaleResult = await insertFileChanges({
        changeRationales,
        checkpointId,
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
    const objectiveId = resolved.session.objective_id;
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
        // Mark the delivering session's objective as complete. Scope strictly
        // to this objective_id so a draft that auto-advanced into 'executing'
        // mid-deliver cannot be swept into 'complete' alongside it.
        const completedAt = new Date().toISOString();
        const { error: completeError } = await supabase
          .from('objectives')
          .update({ state: 'complete', completed_at: completedAt })
          .eq('id', objectiveId)
          .eq('ticket_id', ticketId)
          .in('state', ['executing', 'pending_delivery', 'submitted', 'draft']);
        if (completeError) {
          console.error('[protocol:deliver] objective complete error:', completeError.message);
          Sentry.captureException(completeError, {
            extra: { ticketId, sessionId, objectiveId }
          });
        }

        // Close the delivering session before emitting any auto_advance event.
        // Desktop launchers skip auto-advance while a ticket has an active
        // session; if the event arrives first, the launch can be skipped forever.
        await supabase
          .from('agent_sessions')
          .update({
            detached_at: new Date().toISOString(),
            session_state: 'completed'
          })
          .eq('id', sessionId);

        // Auto-advance scheduler: prefer the current draft objective (when it has
        // content), otherwise the earliest future objective. Desktop observers
        // launch auto_advance=true rows; gated rows wait for human approval.
        const queueResult = await scheduleQueuedObjectiveAfterDeliver({
          supabase: typedSupabase,
          ticketId,
          userId,
          organizationId,
          ticketReference
        });

        if (queueResult.advanced) {
          if (artifacts.length) {
            const artifactRows = artifacts.map(artifact => ({
              artifact_type: artifact.type,
              content: artifact.content ?? null,
              event_id: eventId,
              label: artifact.label,
              metadata: artifact.metadata,
              objective_id: objectiveId,
              ticket_id: ticketId,
              uri: artifact.uri ?? null,
              created_by: userId
            }));
            await supabase.from('artifacts').insert(artifactRows);
          }

          try {
            const { error: feedError } = await supabase.functions.invoke('generate-feed-post', {
              body: { ticketId, objectiveId, organizationId }
            });
            if (feedError) {
              console.error('[protocol:deliver] feed post generation failed:', feedError.message);
              Sentry.captureException(feedError, { extra: { ticketId, objectiveId } });
            }
          } catch (feedErr) {
            console.error('[protocol:deliver] feed post generation error:', feedErr);
            Sentry.captureException(feedErr, { extra: { ticketId, objectiveId } });
          }

          return;
        }

        if (artifacts.length) {
          const artifactRows = artifacts.map(artifact => ({
            artifact_type: artifact.type,
            content: artifact.content ?? null,
            event_id: eventId,
            label: artifact.label,
            metadata: artifact.metadata,
            objective_id: objectiveId,
            ticket_id: ticketId,
            uri: artifact.uri ?? null,
            created_by: userId
          }));
          const { error: artifactError } = await supabase.from('artifacts').insert(artifactRows);
          if (artifactError) {
            console.error('[protocol:deliver] artifact insert error:', artifactError.message);
            Sentry.captureException(artifactError, {
              extra: { ticketId, objectiveId, eventId }
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

        const { error: ticketError } = await supabase
          .from('tickets')
          .update({
            is_read: false,
            status: reviewStatusName,
            board_position: topBoardPosition
          })
          .eq('id', ticketId);

        if (ticketError) {
          console.error('[protocol:deliver] ticket update error:', ticketError.message);
          Sentry.captureException(ticketError, { extra: { ticketId } });
        }

        // Emit status_change event so KanbanBoard realtime listener triggers
        // the review sound and highlights has_unopened_review for agent deliveries.
        // Carry the agent's delivery summary forward so the notification classifier
        // (and the activity log entry it renders) reflect what was actually delivered.
        const reviewSummary = summary || 'Ticket delivered and moved to review.';
        const { data: statusChangeEvent } = await supabase
          .from('ticket_events')
          .insert({
            event_type: 'status_change',
            phase: 'review',
            summary: reviewSummary,
            objective_id: objectiveId,
            ticket_id: ticketId,
            created_by: userId
          })
          .select('id')
          .single();

        // Generate feed post (fire-and-forget — non-fatal if it fails)
        try {
          const { error: feedError } = await supabase.functions.invoke('generate-feed-post', {
            body: { ticketId, objectiveId, organizationId }
          });
          if (feedError) {
            console.error('[protocol:deliver] feed post generation failed:', feedError.message);
            Sentry.captureException(feedError, { extra: { ticketId, objectiveId } });
          }
        } catch (feedErr) {
          console.error('[protocol:deliver] feed post generation error:', feedErr);
          Sentry.captureException(feedErr, { extra: { ticketId, objectiveId } });
        }

        // Send mobile push notification via the canonical orchestrator so the
        // push title/body/data shape match the in-app realtime consumers.
        await emitWorkflowNotification({
          supabase,
          event: {
            id: statusChangeEvent?.id ?? null,
            event_type: 'status_change',
            phase: 'review',
            summary: reviewSummary
          },
          organizationId,
          ticketId,
          ticketReference,
          ticketTitle: ticket?.title ?? null,
          objectiveId
        });
      } catch (bgErr) {
        console.error('[protocol:deliver] background job error:', bgErr);
        Sentry.captureException(bgErr, { extra: { ticketId, sessionId, objectiveId } });
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
