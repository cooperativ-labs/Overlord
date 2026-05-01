'use server';

import {
  createDefaultTicketListFilters,
  normalizeStringList,
  normalizeTicketListFilters,
  parseTicketListFilters,
  type TicketListFilters
} from '@/lib/helpers/ticket-list-filters';
import { createClientForRequest } from '@/supabase/utils/server';

export type ProjectUserPreferences = {
  feed_post_instructions: string | null;
  hidden_columns: string[];
  preferred_view: string | null;
  list_filters: TicketListFilters;
  list_collapsed_statuses: string[];
  list_status_order: string[];
};

const DEFAULT_PREFERENCES: ProjectUserPreferences = {
  feed_post_instructions: null,
  hidden_columns: [],
  preferred_view: null,
  list_filters: createDefaultTicketListFilters(),
  list_collapsed_statuses: [],
  list_status_order: []
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePreferences(raw: unknown): ProjectUserPreferences {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return DEFAULT_PREFERENCES;
  }
  const obj = raw as Record<string, unknown>;
  return {
    feed_post_instructions: normalizeOptionalString(obj.feed_post_instructions),
    hidden_columns: normalizeStringList(obj.hidden_columns),
    preferred_view: typeof obj.preferred_view === 'string' ? obj.preferred_view : null,
    list_filters: parseTicketListFilters(obj.list_filters),
    list_collapsed_statuses: normalizeStringList(obj.list_collapsed_statuses),
    list_status_order: normalizeStringList(obj.list_status_order)
  };
}

export async function getProjectUserPreferencesAction(
  projectId: string
): Promise<ProjectUserPreferences> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return DEFAULT_PREFERENCES;

  const { data, error } = await supabase
    .from('project_user')
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
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return;

  // Fetch existing preferences to merge
  const { data: existing } = await supabase
    .from('project_user')
    .select('preferences')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .single();

  const current = parsePreferences(existing?.preferences);
  const merged: ProjectUserPreferences = {
    feed_post_instructions:
      patch.feed_post_instructions !== undefined
        ? normalizeOptionalString(patch.feed_post_instructions)
        : current.feed_post_instructions,
    hidden_columns:
      patch.hidden_columns !== undefined
        ? normalizeStringList(patch.hidden_columns)
        : current.hidden_columns,
    preferred_view:
      patch.preferred_view !== undefined ? patch.preferred_view : current.preferred_view,
    list_filters:
      patch.list_filters !== undefined
        ? normalizeTicketListFilters(patch.list_filters)
        : current.list_filters,
    list_collapsed_statuses:
      patch.list_collapsed_statuses !== undefined
        ? normalizeStringList(patch.list_collapsed_statuses)
        : current.list_collapsed_statuses,
    list_status_order:
      patch.list_status_order !== undefined
        ? normalizeStringList(patch.list_status_order)
        : current.list_status_order
  };

  const { error } = await supabase.from('project_user').upsert(
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
