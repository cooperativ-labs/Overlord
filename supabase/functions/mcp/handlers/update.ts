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

export async function handleUpdate(supabase: SupabaseClient, args: any, ctx: TokenContext) {
  const {
    sessionKey,
    ticketId: rawTicketId,
    summary,
    phase,
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

  // Detect when an agent continues working on a ticket that was already delivered.
  // Auto-transition the ticket back to execute and reactivate the session.
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

  if (isResumeAfterDelivery) {
    const executeStatusName = await resolvePreferredStatusNameByType(
      supabase,
      ctx.organizationId,
      'execute'
    );
    await Promise.all([
      supabase.from('tickets').update({ status: executeStatusName }).eq('id', ticketId),
      supabase
        .from('agent_sessions')
        .update({ session_state: 'active', detached_at: null })
        .eq('id', resolved.session.id),
      supabase.from('ticket_events').insert({
        event_type: 'ticket_reopened',
        phase: 'execute',
        objective_id: resolved.session.objective_id,
        summary: 'Ticket resumed — agent continued working after delivery.',
        ticket_id: ticketId,
        created_by: ctx.userId
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

  const { data: event, error: eventErr } = await supabase
    .from('ticket_events')
    .insert({
      event_type: 'update',
      payload,
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
        .eq('state', 'executing');
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
