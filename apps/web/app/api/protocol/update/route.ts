import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { after, NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { resolveObjectiveModelIdentifier } from '@/lib/objectives';
import {
  buildAgentNotificationSummary,
  extractAgentNotifications
} from '@/lib/overlord/agent-notifications';
import { upsertObjectiveCheckpoint } from '@/lib/overlord/checkpoints';
import { insertFileChanges } from '@/lib/overlord/file-changes';
import { markObjectivePendingDeliveryAfterPriorDelivery } from '@/lib/overlord/follow-up-delivery';
import { emitWorkflowNotification } from '@/lib/overlord/notifications/orchestrator';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { updateSchema } from '@/lib/overlord/validation';
import {
  resolvePreferredStatusNameByType,
  resolveStatusNameForPhase,
  resolveStatusTypeForName
} from '@/lib/ticket-statuses';
import { createServiceRoleClient } from '@/supabase/utils/service-role';
import type { Database } from '@/types/database.types';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, updateSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      changeRationales,
      beginFollowUpWork,
      eventType,
      externalSessionId,
      externalUrl,
      followUpIntent,
      payload,
      phase,
      snapshot,
      sessionKey,
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
    const resolved = await resolveSession(sessionKey, ticketId, organizationId, {
      allowCompletedReactivation: beginFollowUpWork === true
    });
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    // Delivered/review tickets stay in discussion until the agent explicitly
    // starts follow-up implementation.
    const { data: currentTicket } = await supabase
      .from('tickets')
      .select('status')
      .eq('id', ticketId)
      .single();

    const currentStatusType = currentTicket
      ? await resolveStatusTypeForName(supabase, organizationId, currentTicket.status)
      : null;
    const isResumeAfterDelivery =
      currentStatusType === 'review' || currentStatusType === 'complete';

    if (isResumeAfterDelivery && phase === 'execute' && !beginFollowUpWork) {
      return NextResponse.json(
        {
          error:
            'Delivered/review tickets require beginFollowUpWork=true before moving back to execute.'
        },
        { status: 400 }
      );
    }

    if (isResumeAfterDelivery && beginFollowUpWork) {
      const executeStatusName = await resolvePreferredStatusNameByType(
        supabase,
        organizationId,
        'execute'
      );
      await Promise.all([
        supabase.from('tickets').update({ status: executeStatusName }).eq('id', ticketId),
        supabase
          .from('agent_sessions')
          .update({ session_state: 'attached', detached_at: null })
          .eq('id', resolved.session.id),
        supabase.from('ticket_events').insert({
          event_type: 'ticket_reopened',
          phase: 'execute',
          objective_id: resolved.session.objective_id,
          summary: 'Follow-up work explicitly started after delivery.',
          ticket_id: ticketId,
          created_by: userId,
          payload: {
            follow_up_intent: 'execution',
            transition: 'begin_follow_up_work'
          }
        }),
        // Reactivate only the most recently completed objective back to executing.
        // PostgREST ignores .order()/.limit() on UPDATE, so we first fetch the ID
        // of the latest complete objective and then update by primary key.
        supabase
          .from('objectives')
          .select('id,assigned_agent')
          .eq('ticket_id', ticketId)
          .eq('state', 'complete')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
          .then(({ data: latestObjective }) => {
            if (latestObjective?.id) {
              return supabase
                .from('objectives')
                .update({
                  state: 'executing',
                  agent_identifier: resolved.session.agent_identifier,
                  model_identifier: resolveObjectiveModelIdentifier({
                    metadata: resolved.session.metadata,
                    objectiveAssignedAgent: latestObjective.assigned_agent ?? null
                  }),
                  completed_at: null
                })
                .eq('id', latestObjective.id);
            }
          })
      ]);
    }

    const eventPayload = {
      ...payload,
      ...(followUpIntent || beginFollowUpWork
        ? { follow_up_intent: beginFollowUpWork ? 'execution' : followUpIntent }
        : {}),
      ...(beginFollowUpWork ? { transition: 'begin_follow_up_work' } : {})
    };

    const { data: event, error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: eventType ?? 'update',
        payload: eventPayload,
        phase: phase ?? null,
        objective_id: resolved.session.objective_id,
        summary,
        ticket_id: ticketId,
        created_by: userId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to create event.' },
        { status: 500 }
      );
    }

    let updateCheckpointId: string | null = null;
    if (snapshot?.gitCommitId && ticket?.project_id) {
      const result = await upsertObjectiveCheckpoint({
        supabase: typedSupabase,
        organizationId,
        projectId: ticket.project_id,
        ticketId,
        sessionId: resolved.session.id,
        eventId: event.id,
        userId,
        snapshot,
        checkpoint: { kind: 'objective' },
        fallbackSummary: summary
      });
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      updateCheckpointId = result.checkpointId;
    }

    if (Array.isArray(changeRationales) && changeRationales.length > 0) {
      const rationaleResult = await insertFileChanges({
        changeRationales,
        checkpointId: updateCheckpointId,
        eventId: event.id,
        sessionId: resolved.session.id,
        supabase: typedSupabase,
        ticketId
      });

      if (rationaleResult.error) {
        console.error('[protocol:update] change rationale insert error:', rationaleResult.error);
        Sentry.captureException(new Error(rationaleResult.error), {
          extra: { ticketId, sessionId: resolved.session.id, eventId: event.id }
        });
        // Non-fatal: continue with update even if rationale insertion fails
      }
    }

    const pendingDeliveryResult = await markObjectivePendingDeliveryAfterPriorDelivery({
      supabase: typedSupabase,
      ticketId,
      objectiveId: resolved.session.objective_id,
      signal: {
        beginFollowUpWork,
        changeRationales,
        eventType: eventType ?? 'update',
        followUpIntent: beginFollowUpWork ? 'execution' : followUpIntent,
        phase: phase ?? null,
        payload,
        snapshot
      }
    });
    if (pendingDeliveryResult.error) {
      return NextResponse.json({ error: pendingDeliveryResult.error }, { status: 500 });
    }

    if (externalUrl !== undefined || externalSessionId !== undefined) {
      const sessionUpdate: Record<string, string | null> = {};
      if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
      if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

      const { error: sessionUpdateError } = await supabase
        .from('agent_sessions')
        .update(sessionUpdate)
        .eq('id', resolved.session.id);
      if (sessionUpdateError) {
        return NextResponse.json({ error: sessionUpdateError.message }, { status: 500 });
      }
    }

    const notifications = extractAgentNotifications(payload);
    if (notifications.length > 0) {
      const notificationRows = notifications.map(notification => ({
        event_type: (notification.kind === 'question' ? 'question' : 'alert') as
          | 'question'
          | 'alert',
        is_blocking: notification.kind === 'question' ? notification.isBlocking : false,
        payload: {
          entry_type: 'agent_notification',
          level: notification.level,
          kind: notification.kind,
          message: notification.message,
          metadata: notification.metadata,
          parent_event_id: event.id,
          title: notification.title ?? null
        } as Record<string, unknown>,
        phase: phase ?? null,
        objective_id: resolved.session.objective_id,
        summary: buildAgentNotificationSummary(notification),
        ticket_id: ticketId,
        created_by: userId
      }));

      const { data: insertedNotificationEvents, error: notificationsError } = await supabase
        .from('ticket_events')
        .insert(notificationRows)
        .select('id');

      if (notificationsError) {
        return NextResponse.json({ error: notificationsError.message }, { status: 500 });
      }

      // Route mobile push through the canonical orchestrator so the title/body
      // come from the same shared classifier the in-app realtime consumers use.
      notificationRows.forEach((row, index) => {
        const insertedId = insertedNotificationEvents?.[index]?.id ?? null;
        after(async () => {
          await emitWorkflowNotification({
            supabase,
            event: {
              id: insertedId,
              event_type: row.event_type,
              is_blocking: row.is_blocking,
              payload: row.payload,
              phase: row.phase,
              summary: row.summary
            },
            organizationId,
            ticketId,
            ticketReference,
            ticketTitle: ticket?.title ?? null,
            objectiveId: resolved.session.objective_id
          });
        });
      });
    }

    if (phase) {
      const targetStatusName = await resolveStatusNameForPhase(supabase, organizationId, phase);
      const ticketUpdate: Record<string, unknown> = { status: targetStatusName };
      const shouldEmitStatusChange =
        currentTicket?.status !== targetStatusName && phase === 'review';

      // If moving to a review-type status, place the ticket at the top of that column
      // and mark it unread so the review indicator appears for the user.
      const statusType = await resolveStatusTypeForName(supabase, organizationId, targetStatusName);

      if (statusType === 'review') {
        const { data: headTickets } = await supabase
          .from('tickets')
          .select('board_position')
          .eq('organization_id', organizationId)
          .eq('status', targetStatusName)
          .neq('id', ticketId)
          .order('board_position', { ascending: true })
          .limit(1);
        ticketUpdate.board_position = (headTickets?.[0]?.board_position ?? 0) - 1;
        ticketUpdate.is_read = false;

        // Generate feed post for review transitions (fire-and-forget)
        const reviewObjectiveId = resolved.session.objective_id;
        after(async () => {
          try {
            const { error: feedError } = await supabase.functions.invoke('generate-feed-post', {
              body: { ticketId, objectiveId: reviewObjectiveId, organizationId }
            });
            if (feedError) {
              console.error('[protocol:update] feed post generation failed:', feedError.message);
              Sentry.captureException(feedError, {
                extra: { ticketId, objectiveId: reviewObjectiveId }
              });
            }
          } catch (feedErr) {
            console.error('[protocol:update] feed post generation error:', feedErr);
            Sentry.captureException(feedErr, {
              extra: { ticketId, objectiveId: reviewObjectiveId }
            });
          }
        });
      }

      if (statusType === 'complete') {
        const completedAt = new Date().toISOString();
        const { error: objectiveError } = await supabase
          .from('objectives')
          .update({ state: 'complete', completed_at: completedAt })
          .eq('ticket_id', ticketId)
          .in('state', ['executing', 'pending_delivery']);
        if (objectiveError) {
          return NextResponse.json({ error: objectiveError.message }, { status: 500 });
        }
      }

      const { error: ticketError } = await supabase
        .from('tickets')
        .update(ticketUpdate)
        .eq('id', ticketId);
      if (ticketError) {
        return NextResponse.json({ error: ticketError.message }, { status: 500 });
      }

      if (shouldEmitStatusChange) {
        const reviewSummary = summary?.trim() || 'Objective moved to review.';
        const { data: statusChangeEvent, error: statusChangeError } = await supabase
          .from('ticket_events')
          .insert({
            event_type: 'status_change',
            phase,
            objective_id: resolved.session.objective_id,
            summary: reviewSummary,
            ticket_id: ticketId,
            created_by: userId
          })
          .select('id')
          .single();
        if (statusChangeError) {
          return NextResponse.json({ error: statusChangeError.message }, { status: 500 });
        }

        // Mirror the deliver route: route review notifications through the
        // orchestrator so update --phase review reaches mobile push too.
        after(async () => {
          await emitWorkflowNotification({
            supabase,
            event: {
              id: statusChangeEvent?.id ?? null,
              event_type: 'status_change',
              phase,
              summary: reviewSummary
            },
            organizationId,
            ticketId,
            ticketReference,
            ticketTitle: ticket?.title ?? null,
            objectiveId: resolved.session.objective_id
          });
        });
      }
    }

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
