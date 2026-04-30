// Canonical user preference for the active organization scope.
//
// The DB-backed preference (profiles.preferences.active_organization_id) is the
// cross-device source of truth. The selected-org cookie is an SSR mirror only.
// Three preference states:
//   - unset: user has never made a selection (bootstrap → first org)
//   - all:   user explicitly chose "All organizations" scope (read/search across orgs)
//   - org:   user selected a specific organization
//
// Encoding:
//   profiles.preferences[ACTIVE_ORG_PREF_KEY]:
//     missing key  → unset
//     null         → all
//     positive int → org
//
//   selected-org-id cookie value:
//     absent       → unset
//     'all'        → all
//     positive int → org

export const ACTIVE_ORG_PREF_KEY = 'active_organization_id';
export const SELECTED_ORG_COOKIE = 'selected-org-id';
export const SELECTED_ORG_COOKIE_ALL_VALUE = 'all';

export type ActiveOrgPreference =
  | { kind: 'unset' }
  | { kind: 'all' }
  | { kind: 'org'; organizationId: number };

export function readActiveOrgPreferenceFromProfile(
  profilePreferences: unknown
): ActiveOrgPreference {
  if (!profilePreferences || typeof profilePreferences !== 'object') {
    return { kind: 'unset' };
  }
  const record = profilePreferences as Record<string, unknown>;
  if (!(ACTIVE_ORG_PREF_KEY in record)) return { kind: 'unset' };
  const value = record[ACTIVE_ORG_PREF_KEY];
  if (value === null) return { kind: 'all' };
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { kind: 'org', organizationId: value };
  }
  return { kind: 'unset' };
}

export function readActiveOrgPreferenceFromCookie(
  cookieValue: string | null | undefined
): ActiveOrgPreference {
  if (typeof cookieValue !== 'string') return { kind: 'unset' };
  const trimmed = cookieValue.trim();
  if (!trimmed) return { kind: 'unset' };
  if (trimmed.toLowerCase() === SELECTED_ORG_COOKIE_ALL_VALUE) return { kind: 'all' };
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) {
    return { kind: 'org', organizationId: parsed };
  }
  return { kind: 'unset' };
}

export function activeOrgPreferenceToCookieValue(orgId: number | null): string {
  return orgId === null ? SELECTED_ORG_COOKIE_ALL_VALUE : String(orgId);
}

export function mergeActiveOrgPreferenceIntoProfile(
  existing: unknown,
  orgId: number | null
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
  base[ACTIVE_ORG_PREF_KEY] = orgId;
  return base;
}
