import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type FollowUpClient = SupabaseClient<Database>;

export type FollowUpWorkSignalInput = {
  beginFollowUpWork?: boolean;
  changeRationales?: readonly unknown[];
  eventType?: string | null;
  followUpIntent?: string | null;
  phase?: string | null;
  payload?: Record<string, unknown>;
  snapshot?: {
    diffStat?: string | null;
    gitCommitId?: string | null;
  } | null;
};

function hasMeaningfulCollection(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasMeaningfulFollowUpWorkSignal(input: FollowUpWorkSignalInput): boolean {
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

export async function markObjectivePendingDeliveryAfterPriorDelivery(input: {
  supabase: FollowUpClient;
  ticketId: string;
  objectiveId: string;
  signal: FollowUpWorkSignalInput;
}): Promise<{ marked: boolean; error: string | null }> {
  if (!hasMeaningfulFollowUpWorkSignal(input.signal)) {
    return { marked: false, error: null };
  }

  const { data: priorDelivery, error: deliveryError } = await input.supabase
    .from('ticket_events')
    .select('id')
    .eq('ticket_id', input.ticketId)
    .eq('event_type', 'deliver')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (deliveryError) {
    return { marked: false, error: deliveryError.message };
  }
  if (!priorDelivery) {
    return { marked: false, error: null };
  }

  const { data, error } = await input.supabase
    .from('objectives')
    .update({ state: 'pending_delivery' })
    .eq('id', input.objectiveId)
    .eq('ticket_id', input.ticketId)
    .in('state', ['executing', 'submitted', 'draft', 'complete'])
    .select('id')
    .maybeSingle();

  return {
    marked: Boolean(data?.id),
    error: error?.message ?? null
  };
}

export type DeliveryStatus = {
  needed: boolean;
  reason: string | null;
  signals: string[];
};

export async function checkDeliveryStatus(input: {
  supabase: FollowUpClient;
  ticketId: string;
}): Promise<DeliveryStatus> {
  const { supabase, ticketId } = input;

  const { data: objective } = await supabase
    .from('objectives')
    .select('id, state')
    .eq('ticket_id', ticketId)
    .in('state', ['executing', 'pending_delivery'])
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!objective) {
    return { needed: false, reason: null, signals: [] };
  }

  if (objective.state === 'pending_delivery') {
    const signals: string[] = ['objective_pending_delivery'];

    const { count: rationaleCount } = await supabase
      .from('file_changes')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', ticketId);

    if (rationaleCount && rationaleCount > 0) {
      signals.push('change_rationales_recorded');
    }

    return {
      needed: true,
      reason: 'This session has pending work that should be delivered.',
      signals
    };
  }

  return { needed: false, reason: null, signals: [] };
}
