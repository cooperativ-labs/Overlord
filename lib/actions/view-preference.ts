'use server';

import { cookies } from 'next/headers';

import { getRequestTicketViewPreference } from '@/supabase/utils/server';

const COOKIE_NAME = 'tickets_view';
const VALID_VIEWS = new Set(['board', 'list', 'calendar']);

export async function setViewPreferenceAction(view: string): Promise<void> {
  if (!VALID_VIEWS.has(view)) return;
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, view, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true
  });
}

export async function getViewPreference(): Promise<string> {
  return (await getRequestTicketViewPreference()) ?? 'board';
}

/** Returns null if no preference has been explicitly saved. */
export async function getRawViewPreference(): Promise<string | null> {
  return getRequestTicketViewPreference();
}
