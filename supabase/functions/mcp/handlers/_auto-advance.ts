/// <reference lib="deno.ns" />
import { type SupabaseClient } from '@supabase/supabase-js';

type AssignedAgent = { agent: string; model: string | null; thinking: string | null } | null;

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
    return {
      agent: LAUNCH_AGENTS.includes(value as (typeof LAUNCH_AGENTS)[number]) ? value : 'claude',
      model: null,
      thinking: null
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.agent !== 'string') return null;
  const agent = LAUNCH_AGENTS.includes(rec.agent as (typeof LAUNCH_AGENTS)[number])
    ? rec.agent
    : 'claude';
  const model = typeof rec.model === 'string' ? rec.model : null;
  const thinking = model && typeof rec.thinking === 'string' ? rec.thinking : null;
  return { agent, model, thinking };
}

export type AutoAdvanceResult = { advanced: true } | { advanced: false };

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
    const agentIdentifier = assigned?.agent ?? 'claude';
    const completedAt = new Date().toISOString();

    await supabase
      .from('objectives')
      .update({ state: 'submitted', auto_advanced_at: completedAt })
      .eq('id', nextDraft.id);

    const idempotencyKey = `auto_advance:${nextDraft.id}`;
    const { error: insertErr } = await supabase.from('execution_requests').insert({
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
    });

    if (insertErr && (insertErr as { code?: string }).code !== '23505') {
      console.error('[mcp:deliver] auto-advance execution request error:', insertErr.message);
    }

    await supabase.from('ticket_events').insert({
      event_type: 'execution_requested',
      phase: 'execute',
      summary: 'Queued the next objective for runner execution.',
      ticket_id: ticketId,
      objective_id: nextDraft.id,
      created_by: userId
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
