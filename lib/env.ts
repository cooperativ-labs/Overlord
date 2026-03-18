import type { CookieOptions } from '@supabase/ssr';

import { normalizeEditorScheme } from '@/lib/helpers/editor-scheme';

export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL.');
  }
  return value;
}

export function getSupabasePublishableKey(): string {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
  if (!value) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY).'
    );
  }
  return value;
}

export function getPlatformUrl(providedURL?: string | null): string {
  const value =
    providedURL ??
    process.env.OVERLORD_URL ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : undefined) ??
    process.env.NEXT_PUBLIC_SITE_URL;

  if (!value) {
    throw new Error('Missing platform URL. Set OVERLORD_URL or NEXT_PUBLIC_SITE_URL.');
  }
  return value;
}

export function getSupabaseCookieOptions(providedURL?: string | null): CookieOptions {
  const platformUrl = new URL(getPlatformUrl(providedURL));
  const isOvldHost = platformUrl.hostname === 'ovld.ai' || platformUrl.hostname === 'www.ovld.ai';

  return {
    path: '/',
    sameSite: 'lax',
    secure: platformUrl.protocol === 'https:',
    ...(isOvldHost ? { domain: '.ovld.ai' } : {})
  };
}

export function getOverlordMcpUrl(providedURL?: string | null): string {
  return new URL('/api/mcp', getPlatformUrl(providedURL)).toString();
}

export function getSupabaseSecretKey(): string {
  const value = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error('Missing SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).');
  }
  return value;
}

/** Absolute path to the local workspace root, used to construct editor deep-links. */
export function getWorkspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ?? '';
}

/**
 * URI scheme for opening files in the user's code editor.
 * Set CODE_EDITOR env var to vscode (default), cursor, jetbrains, or a full custom scheme.
 */
export function getEditorScheme(preferredScheme?: string | null): string {
  return normalizeEditorScheme(preferredScheme ?? process.env.CODE_EDITOR ?? null);
}
