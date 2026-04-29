'use server';

import { cookies } from 'next/headers';

import { createClientForRequest, isElectronRequestFromHeaders } from '@/supabase/utils/server';

const COOKIE_NAME = 'tickets_view';
const VALID_VIEWS = new Set(['board', 'list', 'calendar']);
const DB_PREF_KEY = 'ticket_view_preference';

export async function setViewPreferenceAction(view: string): Promise<void> {
  if (!VALID_VIEWS.has(view)) return;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, view, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true
  });

  // Also persist to DB so Electron (where cookies are unreliable) picks it up.
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .single();
    const merged = {
      ...((profile?.preferences as object) ?? {}),
      [DB_PREF_KEY]: view
    };
    await supabase.from('profiles').update({ preferences: merged }).eq('id', user.id);
  }
}

export async function getViewPreference(): Promise<string> {
  return (await getRawViewPreference()) ?? 'board';
}

/** Returns null if no preference has been explicitly saved. */
export async function getRawViewPreference(): Promise<string | null> {
  const isElectron = await isElectronRequestFromHeaders();

  if (isElectron) {
    const supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('preferences')
      .eq('id', user.id)
      .single();
    const prefs = profile?.preferences as Record<string, unknown> | null;
    const view = typeof prefs?.[DB_PREF_KEY] === 'string' ? (prefs[DB_PREF_KEY] as string) : null;
    return VALID_VIEWS.has(view ?? '') ? view : null;
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value ?? null;
  return VALID_VIEWS.has(raw ?? '') ? raw : null;
}
