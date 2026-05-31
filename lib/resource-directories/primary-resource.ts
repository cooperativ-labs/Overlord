import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type ServerSupabase = SupabaseClient<Database>;

export type PrimaryProjectResourceDirectory = {
  projectId: string;
  executionTargetId: string;
  directoryPath: string;
};

type PrimaryResourceRow = {
  project_id: string;
  execution_target_id: string | null;
  directory_path: string;
};

function mapPrimaryRows(rows: PrimaryResourceRow[] | null | undefined) {
  const byProjectId = new Map<string, PrimaryProjectResourceDirectory>();
  for (const row of rows ?? []) {
    if (!row.execution_target_id || byProjectId.has(row.project_id)) continue;
    byProjectId.set(row.project_id, {
      projectId: row.project_id,
      executionTargetId: row.execution_target_id,
      directoryPath: row.directory_path
    });
  }
  return byProjectId;
}

export async function getPrimaryProjectResourceDirectoriesByProjectId(
  supabase: ServerSupabase,
  params: {
    userId: string | null | undefined;
    projectIds: string[];
    executionTargetId?: string | null;
  }
): Promise<Map<string, PrimaryProjectResourceDirectory>> {
  const { userId, projectIds, executionTargetId } = params;
  if (!userId || projectIds.length === 0) return new Map();

  let query = supabase
    .from('project_resource_directories')
    .select('project_id, execution_target_id, directory_path')
    .eq('user_id', userId)
    .in('project_id', projectIds)
    .eq('is_primary', true)
    .order('created_at', { ascending: true });

  if (executionTargetId) {
    query = query.eq('execution_target_id', executionTargetId);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (error) console.error('getPrimaryProjectResourceDirectoriesByProjectId', error);
    return new Map();
  }

  return mapPrimaryRows(data as PrimaryResourceRow[]);
}

export async function targetHasProjectResourceDirectory(
  supabase: ServerSupabase,
  params: {
    projectId: string;
    executionTargetId: string;
  }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('project_resource_directories')
    .select('id')
    .eq('project_id', params.projectId)
    .eq('execution_target_id', params.executionTargetId)
    .limit(1);

  if (error) {
    console.error('targetHasProjectResourceDirectory', error);
    return false;
  }

  return (data ?? []).length > 0;
}
