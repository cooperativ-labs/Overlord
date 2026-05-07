'use server';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createClientForRequest } from '@/supabase/utils/server';
import type { Database } from '@/types/database.types';

import {
  DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS,
  normalizeScheduledTicketVisibilityDays,
  parseScheduledTicketVisibilityDaysPreference
} from '../helpers/scheduled-ticket-visibility';

type ServerSupabase = SupabaseClient<Database>;

export async function getScheduledTicketVisibilityDaysForUser(
  supabase: ServerSupabase,
  userId: string
): Promise<number> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to load scheduled ticket visibility preference.');
  }

  return parseScheduledTicketVisibilityDaysPreference(profile?.preferences);
}

export async function getScheduledTicketVisibilityDaysAction(): Promise<number> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return DEFAULT_SCHEDULED_TICKET_VISIBILITY_DAYS;
  }

  return getScheduledTicketVisibilityDaysForUser(supabase, user.id);
}

export async function saveScheduledTicketVisibilityDaysAction(days: number): Promise<number> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const normalizedDays = normalizeScheduledTicketVisibilityDays(days);
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) {
    throw new Error(
      readError.message ?? 'Failed to load existing scheduled ticket visibility preference.'
    );
  }

  const currentPreferences =
    existing?.preferences &&
    typeof existing.preferences === 'object' &&
    !Array.isArray(existing.preferences)
      ? (existing.preferences as Record<string, unknown>)
      : {};

  const mergedPreferences = {
    ...currentPreferences,
    scheduled_ticket_visibility_days: normalizedDays
  };

  const { error: saveError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, preferences: mergedPreferences }, { onConflict: 'id' });

  if (saveError) {
    throw new Error(saveError.message ?? 'Failed to save scheduled ticket visibility preference.');
  }

  return normalizedDays;
}
