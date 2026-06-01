import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

import {
  type ActiveOrgPreference,
  readActiveOrgPreferenceFromCookie,
  readActiveOrgPreferenceFromProfile,
  SELECTED_ORG_COOKIE
} from '@/lib/active-organization-preference';
import {
  ELECTRON_CLIENT_HEADER,
  ELECTRON_CLIENT_VALUE,
  ELECTRON_UA_SUBSTRING
} from '@/lib/auth/electron-detect';
import { DEFAULT_PROJECT_COOKIE } from '@/lib/default-project';
import { getSupabaseCookieOptions, getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env';

type RequestCookieLike = {
  value: string;
};

type CookieStoreLike = {
  get(name: string): RequestCookieLike | undefined;
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: Record<string, unknown>): void;
};

type HeaderStoreLike = {
  get(name: string): string | null;
};

const SIDEBAR_STATE_COOKIE = 'sidebar_state';
const TICKETS_VIEW_COOKIE = 'tickets_view';
const VALID_TICKET_VIEWS = new Set(['board', 'list', 'calendar']);

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isElectronRequestFromHeaderStore(headerStore: HeaderStoreLike): boolean {
  const clientHeader = headerStore.get(ELECTRON_CLIENT_HEADER);
  if (clientHeader) {
    return clientHeader.toLowerCase() === ELECTRON_CLIENT_VALUE;
  }

  const userAgent = headerStore.get('user-agent') ?? '';
  return userAgent.includes(ELECTRON_UA_SUBSTRING) || userAgent.toLowerCase().includes('electron');
}

export function resolveRequestDefaultProjectId(options: {
  isElectron: boolean;
  cookieDefaultProjectId?: string | null;
  profileDefaultProjectId?: string | null;
}): string | null {
  const profileDefaultProjectId = normalizeOptionalString(options.profileDefaultProjectId);
  if (options.isElectron) {
    return profileDefaultProjectId;
  }

  return profileDefaultProjectId ?? normalizeOptionalString(options.cookieDefaultProjectId);
}

/**
 * Resolves the active organization scope from the canonical user preference,
 * with the cookie acting as an SSR fast-path mirror on web only.
 *
 * Returns:
 *   - a positive integer org id when a specific org is selected
 *   - null when "All organizations" is the active scope (explicit, or bootstrap
 *     with no organizations available)
 *
 * Resolution order:
 *   - Web: cookie (if set) → profile preference (if set) → first org
 *   - Electron: profile preference (if set) → first org
 *
 * The default-project-org fallback that previously applied on Electron is
 * intentionally removed; both platforms now resolve the same canonical
 * preference.
 */
export function resolveRequestSelectedOrganizationId(options: {
  isElectron: boolean;
  cookiePreference: ActiveOrgPreference;
  profilePreference: ActiveOrgPreference;
  organizations?: Array<{ id: number }>;
}): number | null {
  const primary = options.isElectron
    ? options.profilePreference
    : options.cookiePreference.kind !== 'unset'
      ? options.cookiePreference
      : options.profilePreference;

  if (primary.kind === 'all') return null;
  if (primary.kind === 'org') return primary.organizationId;

  const firstOrg = options.organizations?.find(organization => Number.isFinite(organization.id));
  return firstOrg?.id ?? null;
}

export function resolveRequestSidebarOpen(options: {
  isElectron: boolean;
  cookieSidebarState?: string | null;
}): boolean {
  if (options.isElectron) {
    return true;
  }

  return options.cookieSidebarState !== 'false';
}

export function resolveRequestTicketViewPreference(options: {
  isElectron: boolean;
  cookieViewPreference?: string | null;
}): string | null {
  if (options.isElectron) {
    return null;
  }

  const value = normalizeOptionalString(options.cookieViewPreference);
  return VALID_TICKET_VIEWS.has(value ?? '') ? value : null;
}

async function readRequestHeaders(): Promise<HeaderStoreLike | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

async function readRequestCookies(): Promise<CookieStoreLike | null> {
  try {
    return (await cookies()) as unknown as CookieStoreLike;
  } catch {
    return null;
  }
}

export async function isElectronRequestFromHeaders(): Promise<boolean> {
  const headerStore = await readRequestHeaders();
  return headerStore ? isElectronRequestFromHeaderStore(headerStore) : false;
}

export async function getRequestDefaultProjectId(
  options: {
    profileDefaultProjectId?: string | null;
  } = {}
): Promise<string | null> {
  const [isElectron, cookieStore] = await Promise.all([
    isElectronRequestFromHeaders(),
    readRequestCookies()
  ]);

  return resolveRequestDefaultProjectId({
    isElectron,
    cookieDefaultProjectId: cookieStore?.get(DEFAULT_PROJECT_COOKIE)?.value ?? null,
    profileDefaultProjectId: options.profileDefaultProjectId
  });
}

export async function getRequestSelectedOrganizationId(
  options: {
    organizations?: Array<{ id: number }>;
    profilePreferences?: unknown;
  } = {}
): Promise<number | null> {
  const [isElectron, cookieStore] = await Promise.all([
    isElectronRequestFromHeaders(),
    readRequestCookies()
  ]);

  return resolveRequestSelectedOrganizationId({
    isElectron,
    cookiePreference: readActiveOrgPreferenceFromCookie(
      cookieStore?.get(SELECTED_ORG_COOKIE)?.value ?? null
    ),
    profilePreference: readActiveOrgPreferenceFromProfile(options.profilePreferences ?? null),
    organizations: options.organizations
  });
}

export async function getRequestSidebarOpen(): Promise<boolean> {
  const [isElectron, cookieStore] = await Promise.all([
    isElectronRequestFromHeaders(),
    readRequestCookies()
  ]);

  return resolveRequestSidebarOpen({
    isElectron,
    cookieSidebarState: cookieStore?.get(SIDEBAR_STATE_COOKIE)?.value ?? null
  });
}

export async function getRequestTicketViewPreference(): Promise<string | null> {
  const [isElectron, cookieStore] = await Promise.all([
    isElectronRequestFromHeaders(),
    readRequestCookies()
  ]);

  return resolveRequestTicketViewPreference({
    isElectron,
    cookieViewPreference: cookieStore?.get(TICKETS_VIEW_COOKIE)?.value ?? null
  });
}

async function resolveRequestBearerToken(): Promise<string | null> {
  const headerStore = await readRequestHeaders();
  if (!headerStore) {
    return null;
  }

  return (
    extractBearerToken(headerStore.get('authorization')) ??
    headerStore.get('x-overlord-access-token')?.trim() ??
    null
  );
}

export function createElectronClient(accessToken: string) {
  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Electron requests authenticate via request headers, not browser cookies.
      }
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      experimental: { passkey: true }
    }
  });
}

export async function createClientForRequest() {
  const bearerToken = await resolveRequestBearerToken();
  if (bearerToken) {
    return createElectronClient(bearerToken);
  }

  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookieOptions: getSupabaseCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Ignore write attempts from Server Components.
        }
      }
    },
    auth: {
      experimental: { passkey: true }
    }
  });
}

export async function createClient() {
  return createClientForRequest();
}
