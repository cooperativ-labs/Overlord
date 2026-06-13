import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type AgentSessionClient = SupabaseClient<Database>;
type SessionState = Database['public']['Enums']['session_state'];

export const ACTIVE_SESSION_STATES = ['attached', 'idle', 'blocked'] as const;

export const STALE_SESSION_REATTACH_MESSAGE =
  'Session is no longer attached. Call attach again to start a new session.';

export function isAttachedSessionState(sessionState: SessionState): boolean {
  return sessionState === 'attached';
}

export function isProtocolUsableSessionState(
  sessionState: SessionState,
  options?: { allowCompletedReactivation?: boolean }
): boolean {
  if (sessionState === 'attached') return true;
  if (options?.allowCompletedReactivation && sessionState === 'completed') return true;
  return false;
}

/**
 * Re-attach is only valid when the objective's latest session has not already
 * been completed (delivered). Disconnected sessions still allow recovery.
 */
export async function canReattachExecutingObjective({
  supabase,
  objectiveId
}: {
  supabase: AgentSessionClient;
  objectiveId: string;
}): Promise<boolean> {
  const { data: latestSession, error } = await supabase
    .from('agent_sessions')
    .select('session_state')
    .eq('objective_id', objectiveId)
    .order('attached_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!latestSession) return true;
  return latestSession.session_state !== 'completed';
}

export async function disconnectActiveAgentSessionsForObjective({
  supabase,
  objectiveId
}: {
  supabase: AgentSessionClient;
  objectiveId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'disconnected', detached_at: new Date().toISOString() })
    .eq('objective_id', objectiveId)
    .in('session_state', [...ACTIVE_SESSION_STATES]);

  if (error) {
    throw new Error(error.message);
  }
}

export async function completeActiveAgentSessionsForObjective({
  supabase,
  objectiveId
}: {
  supabase: AgentSessionClient;
  objectiveId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('agent_sessions')
    .update({ session_state: 'completed', detached_at: new Date().toISOString() })
    .eq('objective_id', objectiveId)
    .in('session_state', [...ACTIVE_SESSION_STATES]);

  if (error) {
    throw new Error(error.message);
  }
}
