'use server';

import { cookies } from 'next/headers';

const COOKIE_NAME = 'tickets_view';
const VALID_VIEWS = new Set(['board', 'list']);

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
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return VALID_VIEWS.has(value ?? '') ? (value as string) : 'board';
}

/** Returns null if no preference has been explicitly saved. */
export async function getRawViewPreference(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;
  return VALID_VIEWS.has(value ?? '') ? (value as string) : null;
}
