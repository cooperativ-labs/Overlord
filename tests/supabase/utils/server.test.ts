import {
  resolveRequestDefaultProjectId,
  resolveRequestSelectedOrganizationId,
  resolveRequestSidebarOpen,
  resolveRequestTicketViewPreference
} from '@/supabase/utils/server';

describe('request preference resolution', () => {
  it('keeps cookie fallback for web default projects but ignores it in Electron', () => {
    expect(
      resolveRequestDefaultProjectId({
        isElectron: false,
        cookieDefaultProjectId: 'cookie-project',
        profileDefaultProjectId: null
      })
    ).toBe('cookie-project');

    expect(
      resolveRequestDefaultProjectId({
        isElectron: true,
        cookieDefaultProjectId: 'cookie-project',
        profileDefaultProjectId: null
      })
    ).toBeNull();
  });

  describe('selected organization preference', () => {
    it('prefers cookie over profile preference on web', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: false,
          cookiePreference: { kind: 'org', organizationId: 42 },
          profilePreference: { kind: 'org', organizationId: 7 },
          organizations: [{ id: 9 }]
        })
      ).toBe(42);
    });

    it('falls back to profile preference on web when cookie is unset', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: false,
          cookiePreference: { kind: 'unset' },
          profilePreference: { kind: 'org', organizationId: 7 },
          organizations: [{ id: 9 }]
        })
      ).toBe(7);
    });

    it('ignores cookie on Electron and reads profile preference', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: true,
          cookiePreference: { kind: 'org', organizationId: 42 },
          profilePreference: { kind: 'org', organizationId: 7 },
          organizations: [{ id: 9 }]
        })
      ).toBe(7);
    });

    it('returns null when profile preference is explicit "all" (Electron)', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: true,
          cookiePreference: { kind: 'unset' },
          profilePreference: { kind: 'all' },
          organizations: [{ id: 9 }]
        })
      ).toBeNull();
    });

    it('returns null when cookie is explicit "all" (web)', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: false,
          cookiePreference: { kind: 'all' },
          profilePreference: { kind: 'org', organizationId: 7 },
          organizations: [{ id: 9 }]
        })
      ).toBeNull();
    });

    it('bootstraps to first organization when nothing is set', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: true,
          cookiePreference: { kind: 'unset' },
          profilePreference: { kind: 'unset' },
          organizations: [{ id: 9 }, { id: 10 }]
        })
      ).toBe(9);

      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: false,
          cookiePreference: { kind: 'unset' },
          profilePreference: { kind: 'unset' },
          organizations: [{ id: 9 }]
        })
      ).toBe(9);
    });

    it('returns null when nothing is set and the user has no organizations', () => {
      expect(
        resolveRequestSelectedOrganizationId({
          isElectron: false,
          cookiePreference: { kind: 'unset' },
          profilePreference: { kind: 'unset' },
          organizations: []
        })
      ).toBeNull();
    });
  });

  it('forces the desktop sidebar open state to a deterministic default', () => {
    expect(resolveRequestSidebarOpen({ isElectron: false, cookieSidebarState: 'false' })).toBe(
      false
    );
    expect(resolveRequestSidebarOpen({ isElectron: true, cookieSidebarState: 'false' })).toBe(true);
  });

  it('validates cookie ticket views on web; Electron reads from DB so resolveRequestTicketViewPreference returns null for it', () => {
    expect(
      resolveRequestTicketViewPreference({
        isElectron: false,
        cookieViewPreference: 'list'
      })
    ).toBe('list');
    expect(
      resolveRequestTicketViewPreference({
        isElectron: false,
        cookieViewPreference: 'invalid'
      })
    ).toBeNull();
    // Electron bypasses this resolver entirely — getRawViewPreference() queries
    // profiles.preferences instead, so the resolver still returns null here.
    expect(
      resolveRequestTicketViewPreference({
        isElectron: true,
        cookieViewPreference: 'list'
      })
    ).toBeNull();
  });
});
