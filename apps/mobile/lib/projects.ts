import { getSupabase } from './supabase';

export interface ProjectSummary {
  id: string;
  name: string;
  color: string;
}

export async function loadProjectSummaries(): Promise<ProjectSummary[]> {
  const { data, error } = await getSupabase()
    .from('projects')
    .select('id, name, color')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ProjectSummary[];
}
