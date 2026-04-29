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

  it('derives Electron selected organization from stable fallbacks instead of cookies', () => {
    expect(
      resolveRequestSelectedOrganizationId({
        isElectron: false,
        cookieSelectedOrganizationId: '42',
        defaultProjectOrganizationId: 7,
        organizations: [{ id: 9 }]
      })
    ).toBe(42);

    expect(
      resolveRequestSelectedOrganizationId({
        isElectron: true,
        cookieSelectedOrganizationId: '42',
        defaultProjectOrganizationId: 7,
        organizations: [{ id: 9 }]
      })
    ).toBe(7);

    expect(
      resolveRequestSelectedOrganizationId({
        isElectron: true,
        cookieSelectedOrganizationId: null,
        organizations: [{ id: 9 }, { id: 10 }]
      })
    ).toBe(9);
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
