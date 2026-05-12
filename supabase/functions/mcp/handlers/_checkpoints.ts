// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

export type SnapshotInput = {
  diffStat?: string | null;
  gitCommitId?: string | null;
  gitRefName?: string;
  headSha?: string;
  objectiveId?: string;
};

async function resolveObjectiveId(
  supabase: SupabaseClient,
  ticketId: string,
  explicit?: string
): Promise<string | null> {
  if (explicit) return explicit;
  const { data: executing } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .eq('state', 'executing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if ((executing as { id: string } | null)?.id) {
    return (executing as { id: string }).id;
  }
  const { data: latest } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (latest as { id: string } | null)?.id ?? null;
}

export async function upsertObjectiveCheckpoint(args: {
  supabase: SupabaseClient;
  organizationId: number;
  projectId: string;
  ticketId: string;
  sessionId: string;
  eventId: string;
  userId: string | null;
  snapshot: SnapshotInput | undefined;
  checkpoint?: { kind?: string; summary?: string | null; diffStat?: string | null };
  fallbackSummary?: string | null;
}): Promise<{ checkpointId: string | null; error: string | null }> {
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
  return { checkpointId: (data as { id: string }).id, error: null };
}
