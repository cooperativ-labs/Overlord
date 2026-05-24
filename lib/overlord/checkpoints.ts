import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

export type SnapshotInput = {
  diffStat?: string | null;
  gitCommitId?: string | null;
  gitRefName?: string;
  headSha?: string;
  objectiveId?: string;
};

export type CheckpointInput = {
  diffStat?: string | null;
  kind?: 'objective' | 'delivery' | 'manual';
  summary?: string | null;
};

export type UpsertCheckpointArgs = {
  supabase: SupabaseClient<Database>;
  organizationId: number;
  projectId: string;
  ticketId: string;
  sessionId: string;
  eventId: string;
  userId: string | null;
  snapshot: SnapshotInput | undefined;
  checkpoint?: CheckpointInput;
  fallbackSummary?: string | null;
};

/**
 * Resolve the active objective for a ticket. Falls back to the most recently
 * created objective if none are currently executing or pending delivery.
 */
async function resolveObjectiveId(
  supabase: SupabaseClient<Database>,
  ticketId: string,
  explicit?: string
): Promise<string | null> {
  if (explicit) return explicit;
  const { data: executing } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .in('state', ['executing', 'pending_delivery'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (executing?.id) return executing.id;
  const { data: latest } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest?.id ?? null;
}

/**
 * Upsert one project_checkpoints row keyed on (project_id, objective_id).
 * Returns the checkpoint id (or null on error).
 */
export async function upsertObjectiveCheckpoint(
  args: UpsertCheckpointArgs
): Promise<{ checkpointId: string | null; error: string | null }> {
  if (!args.snapshot?.gitCommitId && !args.checkpoint) {
    return { checkpointId: null, error: null };
  }

  const objectiveId = await resolveObjectiveId(
    args.supabase,
    args.ticketId,
    args.snapshot?.objectiveId
  );
  if (!objectiveId) {
    return { checkpointId: null, error: 'Cannot persist a checkpoint without an objective.' };
  }

  const { data, error } = await args.supabase
    .from('project_checkpoints')
    .upsert(
      {
        organization_id: args.organizationId,
        project_id: args.projectId,
        ticket_id: args.ticketId,
        objective_id: objectiveId,
        session_id: args.sessionId,
        event_id: args.eventId,
        checkpoint_kind: args.checkpoint?.kind ?? 'objective',
        git_commit_id: args.snapshot?.gitCommitId ?? null,
        git_ref_name: args.snapshot?.gitRefName ?? null,
        head_sha: args.snapshot?.headSha ?? null,
        summary: args.checkpoint?.summary ?? args.fallbackSummary ?? null,
        diff_stat: args.checkpoint?.diffStat ?? args.snapshot?.diffStat ?? null,
        created_by: args.userId
      },
      { onConflict: 'project_id,objective_id', ignoreDuplicates: false }
    )
    .select('id')
    .single();

  if (error || !data) {
    return { checkpointId: null, error: error?.message ?? 'Failed to upsert checkpoint.' };
  }
  return { checkpointId: data.id, error: null };
}
