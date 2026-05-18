'use server';

import { createClientForRequest } from '@/supabase/utils/server';

export type ProjectCheckpoint = {
  id: string;
  checkpoint_kind: string;
  created_at: string;
  git_commit_id: string | null;
  git_ref_name: string | null;
  head_sha: string | null;
  summary: string | null;
  diff_stat: string | null;
  objective_id: string;
  ticket_id: string | null;
  session_id: string | null;
  objective_state: string | null;
};

export async function listProjectCheckpointsAction(
  projectId: string
): Promise<ProjectCheckpoint[]> {
  const supabase = await createClientForRequest();
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select(
      'id, checkpoint_kind, created_at, git_commit_id, git_ref_name, head_sha, summary, diff_stat, objective_id, ticket_id, session_id, objectives(state)'
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map(row => ({
    id: row.id,
    checkpoint_kind: row.checkpoint_kind,
    created_at: row.created_at,
    git_commit_id: row.git_commit_id,
    git_ref_name: row.git_ref_name,
    head_sha: row.head_sha,
    summary: row.summary,
    diff_stat: row.diff_stat,
    objective_id: row.objective_id,
    ticket_id: row.ticket_id,
    session_id: row.session_id,
    objective_state: (row.objectives as unknown as { state: string } | null)?.state ?? null
  }));
}

export async function deleteProjectCheckpointAction(checkpointId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const { error } = await supabase.from('project_checkpoints').delete().eq('id', checkpointId);

  if (error) throw new Error(error.message);
}

export async function pruneStaleProjectCheckpointsAction(projectId: string): Promise<number> {
  const supabase = await createClientForRequest();

  // Find all complete objectives for this project's checkpoints
  const { data: staleCheckpoints, error: fetchError } = await supabase
    .from('project_checkpoints')
    .select('id, objectives(state)')
    .eq('project_id', projectId);

  if (fetchError) throw new Error(fetchError.message);

  const staleIds = (staleCheckpoints ?? [])
    .filter(row => (row.objectives as unknown as { state: string } | null)?.state === 'complete')
    .map(row => row.id);

  if (staleIds.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from('project_checkpoints')
    .delete()
    .in('id', staleIds);

  if (deleteError) throw new Error(deleteError.message);

  return staleIds.length;
}
