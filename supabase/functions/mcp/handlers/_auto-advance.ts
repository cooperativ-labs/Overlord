/// <reference lib="deno.ns" />
import { type SupabaseClient } from '@supabase/supabase-js';

type AssignedAgent = { agent: string; model: string | null; thinking: string | null } | null;
type ExecutionRequestRow = {
  id: string;
  organization_id: number;
  ticket_id: string;
  objective_id: string;
  status: string;
  [key: string]: unknown;
};

const ACTIVE_REQUEST_STATUSES = ['queued', 'claimed', 'launching'];

const LAUNCH_AGENTS = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'antigravity',
  'agy',
  'opencode'
] as const;

function parseAssignedAgent(value: unknown): AssignedAgent {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return {
      agent: LAUNCH_AGENTS.includes(trimmed as (typeof LAUNCH_AGENTS)[number]) ? trimmed : trimmed,
      model: null,
      thinking: null
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.agent !== 'string') return null;
  const agent = rec.agent.trim();
  if (!agent) return null;
  const model = typeof rec.model === 'string' ? rec.model : null;
  const thinking = model && typeof rec.thinking === 'string' ? rec.thinking : null;
  return { agent, model, thinking };
}

export type AutoAdvanceResult = { advanced: true } | { advanced: false };

async function findActiveRequestForObjective(input: {
  supabase: SupabaseClient;
  organizationId: number;
  objectiveId: string;
}): Promise<ExecutionRequestRow | null> {
  const { data, error } = await input.supabase
    .from('execution_requests')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('objective_id', input.objectiveId)
    .in('status', ACTIVE_REQUEST_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[mcp:deliver] active execution request query error:', error.message);
    return null;
  }
  return (data as ExecutionRequestRow | null) ?? null;
}

async function findExecutionRequestById(input: {
  supabase: SupabaseClient;
  organizationId: number;
  requestId: string;
}): Promise<ExecutionRequestRow | null> {
  const { data, error } = await input.supabase
    .from('execution_requests')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('id', input.requestId)
    .maybeSingle();

  if (error) {
    console.error('[mcp:deliver] execution request refresh error:', error.message);
    return null;
  }
  return (data as ExecutionRequestRow | null) ?? null;
}

async function revertLaunchingObjective(input: {
  supabase: SupabaseClient;
  objectiveId: string;
}): Promise<void> {
  const { error } = await input.supabase
    .from('objectives')
    .update({ state: 'draft', auto_advanced_at: null })
    .eq('id', input.objectiveId)
    .eq('state', 'launching');

  if (error) {
    console.error('[mcp:deliver] auto-advance objective revert error:', error.message);
  }
}

async function emitExecutionRequested(input: {
  supabase: SupabaseClient;
  ticketId: string;
  objectiveId: string;
  userId: string;
  requestId: string;
  reused: boolean;
}): Promise<void> {
  await input.supabase.from('ticket_events').insert({
    event_type: 'execution_requested',
    phase: 'execute',
    summary: input.reused
      ? 'Re-queued the existing objective execution for a runner.'
      : 'Queued the next objective for runner execution.',
    ticket_id: input.ticketId,
    objective_id: input.objectiveId,
    created_by: input.userId,
    payload: {
      execution_request_id: input.requestId,
      requested_from: 'auto_advance',
      ...(input.reused ? { reused_execution_request: true } : {})
    }
  });
}

async function reuseActiveRequest(input: {
  supabase: SupabaseClient;
  existing: ExecutionRequestRow;
  ticketId: string;
  objectiveId: string;
  userId: string;
  organizationId: number;
}): Promise<boolean> {
  let request = input.existing;
  if (input.existing.status !== 'queued') {
    const { data: reset, error: resetErr } = await input.supabase
      .from('execution_requests')
      .update({
        status: 'queued',
        claimed_by_execution_target_id: null,
        claimed_at: null,
        lease_expires_at: null,
        last_error: null
      })
      .eq('id', input.existing.id)
      .eq('organization_id', input.organizationId)
      .eq('objective_id', input.objectiveId)
      .eq('status', input.existing.status)
      .in('status', ['claimed', 'launching'])
      .select('*')
      .maybeSingle();

    if (resetErr) {
      console.error('[mcp:deliver] stale execution request reset error:', resetErr.message);
      return false;
    }
    if (!reset) {
      const latest = await findExecutionRequestById({
        supabase: input.supabase,
        organizationId: input.organizationId,
        requestId: input.existing.id
      });
      if (!latest) return false;
      // Attach won the race: the request is already launched and cannot be
      // re-queued, but auto-advance still achieved its outcome.
      if (latest.status === 'launched') return true;
      // Other terminal states (e.g. failed) mean reuse did not queue work.
      if (!ACTIVE_REQUEST_STATUSES.includes(latest.status)) return false;
      // Another caller reset the row to queued; emit the wake-up below.
      if (latest.status === 'queued') {
        request = latest;
      } else {
        return false;
      }
    } else {
      request = reset as ExecutionRequestRow;
    }
  }

  await emitExecutionRequested({
    supabase: input.supabase,
    ticketId: input.ticketId,
    objectiveId: input.objectiveId,
    userId: input.userId,
    requestId: request.id,
    reused: true
  });
  return true;
}

export async function scheduleAutoAdvanceAfterDeliver(input: {
  supabase: SupabaseClient;
  ticketId: string;
  userId: string;
  organizationId: number;
}): Promise<AutoAdvanceResult> {
  const { supabase, ticketId, userId, organizationId } = input;

  const { data: nextDraft, error: draftErr } = await supabase
    .from('objectives')
    .select('id, objective, auto_advance, approval_reason, assigned_agent')
    .eq('ticket_id', ticketId)
    .eq('state', 'draft')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (draftErr) {
    console.error('[mcp:deliver] auto-advance draft query error:', draftErr.message);
    return { advanced: false };
  }

  if (!nextDraft || !(nextDraft.objective as string | null)?.trim()) {
    return { advanced: false };
  }

  const wantsAutoAdvance = (nextDraft.auto_advance as boolean | null) !== false;

  if (wantsAutoAdvance) {
    const { data: ticketData } = await supabase
      .from('tickets')
      .select('project_id, for_human')
      .eq('id', ticketId)
      .single();

    if ((ticketData as { for_human: boolean | null } | null)?.for_human) {
      return { advanced: false };
    }

    const assigned = parseAssignedAgent(nextDraft.assigned_agent);
    if (!assigned?.agent) {
      console.error('[mcp:deliver] auto-advance skipped: no assigned agent on next objective');
      return { advanced: false };
    }
    const agentIdentifier = assigned.agent;
    const completedAt = new Date().toISOString();

    const activeRequest = await findActiveRequestForObjective({
      supabase,
      organizationId,
      objectiveId: nextDraft.id
    });
    if (activeRequest) {
      const reused = await reuseActiveRequest({
        supabase,
        existing: activeRequest,
        ticketId,
        objectiveId: nextDraft.id,
        userId,
        organizationId
      });
      return { advanced: reused };
    }

    const { error: objectiveUpdateErr } = await supabase
      .from('objectives')
      .update({ state: 'launching', auto_advanced_at: completedAt })
      .eq('id', nextDraft.id)
      .eq('state', 'draft');

    if (objectiveUpdateErr) {
      console.error(
        '[mcp:deliver] auto-advance objective update error:',
        objectiveUpdateErr.message
      );
      return { advanced: false };
    }

    const idempotencyKey = `auto_advance:${nextDraft.id}`;
    const { data: insertedRequest, error: insertErr } = await supabase
      .from('execution_requests')
      .insert({
        organization_id: organizationId,
        ticket_id: ticketId,
        objective_id: nextDraft.id,
        project_id: (ticketData as { project_id: string | null } | null)?.project_id ?? null,
        requested_by: userId,
        requested_from: 'auto_advance',
        agent_identifier: agentIdentifier,
        model_identifier: assigned?.model ?? null,
        thinking_level: assigned?.thinking ?? null,
        launch_mode: 'run',
        launch_params: { flags: [] },
        target_kind: 'any',
        status: 'queued',
        idempotency_key: idempotencyKey
      })
      .select('id')
      .single();

    if (insertErr && (insertErr as { code?: string }).code === '23505') {
      const raceActiveRequest = await findActiveRequestForObjective({
        supabase,
        organizationId,
        objectiveId: nextDraft.id
      });
      if (raceActiveRequest) {
        const reused = await reuseActiveRequest({
          supabase,
          existing: raceActiveRequest,
          ticketId,
          objectiveId: nextDraft.id,
          userId,
          organizationId
        });
        return { advanced: reused };
      }
      console.error(
        '[mcp:deliver] auto-advance insert race could not resolve an active execution request'
      );
      await revertLaunchingObjective({ supabase, objectiveId: nextDraft.id });
      return { advanced: false };
    }

    if (insertErr) {
      console.error('[mcp:deliver] auto-advance execution request error:', insertErr.message);
      await revertLaunchingObjective({ supabase, objectiveId: nextDraft.id });
      return { advanced: false };
    }
    if (!(insertedRequest as { id?: string } | null)?.id) {
      console.error('[mcp:deliver] auto-advance execution request insert returned no id');
      await revertLaunchingObjective({ supabase, objectiveId: nextDraft.id });
      return { advanced: false };
    }

    await emitExecutionRequested({
      supabase,
      ticketId,
      objectiveId: nextDraft.id,
      userId,
      requestId: (insertedRequest as { id: string }).id,
      reused: false
    });
  } else {
    await supabase
      .from('tickets')
      .update({ has_unopened_waiting_response: true, is_read: false })
      .eq('id', ticketId);

    const awaitingSummary =
      (nextDraft.approval_reason as string | null) ||
      'Queued objective is waiting for your approval.';

    await supabase.from('ticket_events').insert({
      event_type: 'awaiting_approval',
      phase: 'execute',
      summary: awaitingSummary,
      ticket_id: ticketId,
      objective_id: nextDraft.id,
      is_blocking: true,
      created_by: userId
    });
  }

  return { advanced: true };
}
