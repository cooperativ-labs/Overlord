import type { AccountConnectionDto, AccountConnectionProviderStatusDto } from '@overlord/contract';

/** Test fixtures for Connected accounts. */
export function connectionFixture(
  overrides: Partial<AccountConnectionDto> = {}
): AccountConnectionDto {
  return {
    id: 'c-1',
    provider: 'everhour',
    organizationId: null,
    scope: 'profile',
    credentialKind: 'api_key',
    account: { id: '1', label: 'Ada', avatarUrl: null },
    scopes: [],
    lastValidatedAt: null,
    serverUrl: 'https://api.everhour.com',
    state: 'connected',
    authorizedWorkspaces: [],
    toolPolicyVersion: 1,
    lastErrorCode: null,
    connectedAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    revision: 1,
    ...overrides
  };
}

export function statusFixture(
  overrides: Partial<AccountConnectionProviderStatusDto> = {}
): AccountConnectionProviderStatusDto {
  return {
    provider: 'everhour',
    scope: 'profile',
    credentialKind: 'api_key',
    available: true,
    reason: null,
    ...overrides
  };
}
