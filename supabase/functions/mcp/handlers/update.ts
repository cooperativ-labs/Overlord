// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';
import { scheduleGenerateFeedPost } from '../helpers/invoke-generate-feed-post.ts';
import { toolErr, toolOk } from '../rpc.ts';
import { resolveSession } from '../session.ts';

import { insertChangeRationales } from './_change-rationales.ts';
import { upsertObjectiveCheckpoint } from './_checkpoints.ts';
import {
  resolvePreferredStatusNameByType,
  resolveStatusNameForPhase,
  resolveStatusTypeForName
} from './_status-resolution.ts';

function readModelIdentifierFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const directModel = typeof record.model === 'string' ? record.model.trim() : '';
  if (directModel) {
    return directModel;
  }

  const selection = record.selection;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    return null;
  }

  const selectionModel = (selection as Record<string, unknown>).model;
  return typeof selectionModel === 'string' && selectionModel.trim().length > 0
    ? selectionModel.trim()
    : null;
}

function readModelIdentifierFromAssignedAgent(assignedAgent: unknown): string | null {
  if (!assignedAgent || typeof assignedAgent !== 'object' || Array.isArray(assignedAgent)) {
    return null;
  }

  const model = (assignedAgent as Record<string, unknown>).model;
  return typeof model === 'string' && model.trim().length > 0 ? model.trim() : null;
}

function hasMeaningfulCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMeaningfulFollowUpWorkSignal(input: {
  beginFollowUpWork?: boolean;
  changeRationales?: unknown[];
  eventType?: string;
  followUpIntent?: string;
  phase?: string;
  payload?: Record<string, unknown>;
  snapshot?: { diffStat?: string | null; gitCommitId?: string | null } | null;
}): boolean {
  if (input.beginFollowUpWork) return false;
  if ((input.changeRationales?.length ?? 0) > 0) return true;
  if (input.snapshot?.gitCommitId?.trim()) return true;
  if (input.snapshot?.diffStat?.trim()) return true;
  if (input.followUpIntent === 'pending_delivery') return true;
  if (
    hasMeaningfulCollection(input.payload?.artifacts) ||
    hasMeaningfulCollection(input.payload?.deliverables)
  ) {
    return true;
  }

  const isExecutionIntent = input.followUpIntent === 'execution' || input.phase === 'execute';
  return isExecutionIntent && (input.eventType ?? 'update') === 'update';
}

async function markObjectivePendingDeliveryAfterPriorDelivery(
  supabase: SupabaseClient,
  input: {
    ticketId: string;
    objectiveId: string;
    signal: Parameters<typeof hasMeaningfulFollowUpWorkSignal>[0];
  }
): Promise<string | null> {
  if (!hasMeaningfulFollowUpWorkSignal(input.signal)) return null;

  const { data: priorDelivery, error: deliveryError } = await supabase
    .from('ticket_events')
    .select('id')
    .eq('ticket_id', input.ticketId)
    .eq('event_type', 'deliver')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (deliveryError) return deliveryError.message;
  if (!priorDelivery) return null;

  const { error } = await supabase
    .from('objectives')
    .update({ state: 'pending_delivery' })
    .eq('id', input.objectiveId)
    .eq('ticket_id', input.ticketId)
    .in('state', ['executing', 'submitted', 'draft', 'complete']);

  return error?.message ?? null;
}

export async function handleUpdate(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    phase,
    beginFollowUpWork = false,
    followUpIntent,
    eventType = 'update',
    externalSessionId,
    externalUrl,
    payload = {},
    changeRationales = [],
    snapshot
  } = args;
  const resolved = await resolveSession(
    supabase,
    sessionKey,
    rawTicketId,
    ctx.organizationId,
    ctx.mcpSessionId
  );
  if (!resolved.session) return toolErr(resolved.error ?? 'Session not found.');
  const ticketId = resolved.resolvedTicketId!;

  // Delivered/review tickets stay in discussion until the agent explicitly
  // starts follow-up implementation.
  const { data: currentTicket } = await supabase
    .from('tickets')
    .select('status')
    .eq('id', ticketId)
    .single();

  const currentStatusType = currentTicket
    ? await resolveStatusTypeForName(
        supabase,
        ctx.organizationId,
        (currentTicket as { status: string }).status
      )
    : null;
  const isResumeAfterDelivery = currentStatusType === 'review' || currentStatusType === 'complete';

  if (isResumeAfterDelivery && phase === 'execute' && !beginFollowUpWork) {
    return toolErr(
      'Delivered/review tickets require beginFollowUpWork=true before moving back to execute.'
    );
  }

  if (isResumeAfterDelivery && beginFollowUpWork) {
    const executeStatusName = await resolvePreferredStatusNameByType(
      supabase,
      ctx.organizationId,
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
        created_by: ctx.userId,
        payload: {
          follow_up_intent: 'execution',
          transition: 'begin_follow_up_work'
        }
      }),
      supabase
        .from('objectives')
        .select('id,assigned_agent')
        .eq('ticket_id', ticketId)
        .eq('state', 'complete')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
        .then(({ data: latestObjective }) => {
          if (!latestObjective?.id) return;
          return supabase
            .from('objectives')
            .update({
              state: 'executing',
              agent_identifier: resolved.session.agent_identifier,
              model_identifier:
                readModelIdentifierFromMetadata(resolved.session.metadata) ??
                readModelIdentifierFromAssignedAgent(latestObjective.assigned_agent ?? null),
              completed_at: null
            })
            .eq('id', latestObjective.id);
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

  const { data: event, error: eventErr } = await supabase
    .from('ticket_events')
    .insert({
      event_type: eventType,
      payload: eventPayload,
      phase: phase ?? null,
      objective_id: resolved.session.objective_id,
      summary,
      ticket_id: ticketId,
      created_by: ctx.userId
    })
    .select('id')
    .single();

  if (eventErr || !event) return toolErr(eventErr?.message ?? 'Failed to create event.');

  let updateCheckpointId: string | null = null;
  if (snapshot?.gitCommitId) {
    const { data: ticketProject } = await supabase
      .from('tickets')
      .select('project_id')
      .eq('id', ticketId)
      .eq('organization_id', ctx.organizationId)
      .single();
    const projectId = (ticketProject as { project_id: string | null } | null)?.project_id;
    if (projectId) {
      const result = await upsertObjectiveCheckpoint({
        supabase,
        organizationId: ctx.organizationId,
        projectId,
        ticketId,
        sessionId: resolved.session.id,
        eventId: event.id,
        userId: ctx.userId,
        snapshot,
        checkpoint: { kind: 'objective' },
        fallbackSummary: summary
      });
      if (result.error) return toolErr(result.error);
      updateCheckpointId = result.checkpointId;
    }
  }

  if (Array.isArray(changeRationales) && changeRationales.length > 0) {
    const rationaleResult = await insertChangeRationales(supabase, {
      changeRationales,
      checkpointId: updateCheckpointId,
      eventId: event.id,
      sessionId: resolved.session.id,
      ticketId
    });
    if (rationaleResult.error) return toolErr(rationaleResult.error);
  }

  const pendingDeliveryError = await markObjectivePendingDeliveryAfterPriorDelivery(supabase, {
    ticketId,
    objectiveId: resolved.session.objective_id,
    signal: {
      beginFollowUpWork,
      changeRationales,
      eventType,
      followUpIntent: beginFollowUpWork ? 'execution' : followUpIntent,
      phase,
      payload,
      snapshot
    }
  });
  if (pendingDeliveryError) return toolErr(pendingDeliveryError);

  if (externalUrl !== undefined || externalSessionId !== undefined) {
    const sessionUpdate: Record<string, string | null> = {};
    if (externalUrl !== undefined) sessionUpdate.external_url = externalUrl;
    if (externalSessionId !== undefined) sessionUpdate.external_session_id = externalSessionId;

    const { error: sessionErr } = await supabase
      .from('agent_sessions')
      .update(sessionUpdate)
      .eq('id', resolved.session.id);
    if (sessionErr) return toolErr(sessionErr.message);
  }

  // Fan out notifications if provided
  const notifications: any[] = Array.isArray(payload?.notifications) ? payload.notifications : [];
  if (notifications.length > 0) {
    await supabase.from('ticket_events').insert(
      notifications.map((n: any) => ({
        event_type: n.kind === 'question' ? 'question' : 'alert',
        is_blocking: n.kind === 'question' ? (n.isBlocking ?? n.blocking ?? false) : false,
        payload: {
          entry_type: 'agent_notification',
          level: n.level,
          kind: n.kind,
          message: n.message,
          metadata: n.metadata,
          parent_event_id: event.id,
          title: n.title ?? null
        },
        phase: phase ?? null,
        objective_id: resolved.session.objective_id,
        summary: n.title ?? n.message ?? 'Agent notification.',
        ticket_id: ticketId,
        created_by: ctx.userId
      }))
    );
  }

  if (phase) {
    const targetStatusName = await resolveStatusNameForPhase(supabase, ctx.organizationId, phase);
    const ticketUpdate: Record<string, unknown> = { status: targetStatusName };
    const shouldEmitStatusChange =
      (currentTicket as { status?: string } | null)?.status !== targetStatusName &&
      phase === 'review';

    // If moving to a review-type status, place the ticket at the top of that column
    const statusType = await resolveStatusTypeForName(
      supabase,
      ctx.organizationId,
      targetStatusName
    );

    if (statusType === 'review') {
      const { data: headTickets } = await supabase
        .from('tickets')
        .select('board_position')
        .eq('organization_id', ctx.organizationId)
        .eq('status', targetStatusName)
        .neq('id', ticketId)
        .order('board_position', { ascending: true })
        .limit(1);
      ticketUpdate.board_position =
        ((headTickets as { board_position: number }[] | null)?.[0]?.board_position ?? 0) - 1;
      ticketUpdate.is_read = false;
    }

    if (statusType === 'complete') {
      await supabase
        .from('objectives')
        .update({ state: 'complete', completed_at: new Date().toISOString() })
        .eq('ticket_id', ticketId)
        .in('state', ['executing', 'pending_delivery']);
    }

    await supabase.from('tickets').update(ticketUpdate).eq('id', ticketId);

    if (shouldEmitStatusChange) {
      await supabase.from('ticket_events').insert({
        event_type: 'status_change',
        phase,
        objective_id: resolved.session.objective_id,
        summary: 'Objective moved to review.',
        ticket_id: ticketId,
        created_by: ctx.userId
      });
    }

    if (statusType === 'review') {
      scheduleGenerateFeedPost({
        supabase,
        ticketId,
        objectiveId: resolved.session.objective_id,
        organizationId: ctx.organizationId,
        logPrefix: '[mcp:update]'
      });
    }
  }

  return toolOk({ ok: true });
}
