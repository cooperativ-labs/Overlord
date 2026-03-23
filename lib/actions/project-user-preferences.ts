'use server';

import { createClient } from '@/supabase/utils/server';

export type ProjectUserPreferences = {
  hidden_columns: string[];
  preferred_view: string | null;
};

const DEFAULT_PREFERENCES: ProjectUserPreferences = {
  hidden_columns: [],
  preferred_view: null
};

function parsePreferences(raw: unknown): ProjectUserPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PREFERENCES;
  }
  const obj = raw as Record<string, unknown>;
  return {
    hidden_columns: Array.isArray(obj.hidden_columns)
      ? (obj.hidden_columns as string[]).filter(v => typeof v === 'string')
      : [],
    preferred_view: typeof obj.preferred_view === 'string' ? obj.preferred_view : null
  };
}

export async function getProjectUserPreferencesAction(
  projectId: string
): Promise<ProjectUserPreferences> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return DEFAULT_PREFERENCES;

  const { data, error } = await supabase
    .from('project_user_preferences')
    .select('preferences')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .single();

  if (error || !data) return DEFAULT_PREFERENCES;

  return parsePreferences(data.preferences);
}

export async function upsertProjectUserPreferencesAction(
  projectId: string,
  patch: Partial<ProjectUserPreferences>
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return;

  // Fetch existing preferences to merge
  const { data: existing } = await supabase
    .from('project_user_preferences')
    .select('preferences')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .single();

  const current = parsePreferences(existing?.preferences);
  const merged: ProjectUserPreferences = { ...current, ...patch };

  const { error } = await supabase.from('project_user_preferences').upsert(
    {
      user_id: user.id,
      project_id: projectId,
      preferences: merged,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id,project_id' }
  );
  if (error) {
    throw new Error(`Failed to update project preferences: ${error.message}`);
  }
}
