'use server';

import { normalizeStringList } from '@/lib/helpers/ticket-list-filters';
import { createClientForRequest } from '@/supabase/utils/server';

export type GlobalListViewPreferences = {
  list_collapsed_statuses: string[];
  list_status_order: string[];
};

const PREFS_KEY = 'list_view_preferences';

const DEFAULT: GlobalListViewPreferences = {
  list_collapsed_statuses: [],
  list_status_order: []
};

export async function getGlobalListViewPreferencesAction(): Promise<GlobalListViewPreferences> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return DEFAULT;

  const prefs = (profile?.preferences as Record<string, unknown> | null) ?? {};
  const raw = prefs[PREFS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT;

  const obj = raw as Record<string, unknown>;
  return {
    list_collapsed_statuses: normalizeStringList(obj.list_collapsed_statuses),
    list_status_order: normalizeStringList(obj.list_status_order)
  };
}

export async function upsertGlobalListViewPreferencesAction(
  patch: Partial<GlobalListViewPreferences>
): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: profile, error: profileReadError } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();

  const prefs = profileReadError
    ? {}
    : ((profile?.preferences as Record<string, unknown> | null) ?? {});
  const existing = prefs[PREFS_KEY];
  const existingObj =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  const merged = {
    ...prefs,
    [PREFS_KEY]: {
      list_collapsed_statuses:
        patch.list_collapsed_statuses !== undefined
          ? normalizeStringList(patch.list_collapsed_statuses)
          : normalizeStringList(existingObj.list_collapsed_statuses),
      list_status_order:
        patch.list_status_order !== undefined
          ? normalizeStringList(patch.list_status_order)
          : normalizeStringList(existingObj.list_status_order)
    }
  };

  const { error: saveError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, preferences: merged }, { onConflict: 'id' });
  if (saveError) {
    throw new Error(`Failed to save global list view preferences: ${saveError.message}`);
  }
}
