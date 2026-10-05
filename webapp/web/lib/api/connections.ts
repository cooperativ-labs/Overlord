import type {
  AccountConnectionDto,
  AccountConnectionListResponse,
  SetAccountConnectionApiKeyBody,
  StartAccountConnectionBody,
  StartAccountConnectionResponse
} from '@overlord/contract';

import { request } from './request.ts';

/**
 * Connected accounts (contract v153): the one place the web app reads and changes
 * external account connections. `?scope=all` adds the caller's profile-scoped
 * connections (Everhour, GitHub) and per-provider availability, and is served on
 * both editions. Credentials are sent once (`setAccountConnectionApiKey`) and
 * never returned.
 */
export const connectionsApi = {
  listAllAccountConnections: () =>
    request<AccountConnectionListResponse>('GET', '/api/connections?scope=all'),
  startAccountConnection: (body: StartAccountConnectionBody) =>
    request<StartAccountConnectionResponse>('POST', '/api/connections', body),
  setAccountConnectionApiKey: (body: SetAccountConnectionApiKeyBody) =>
    request<AccountConnectionDto>('POST', '/api/connections/api-keys', body),
  disconnectAccountConnection: (id: string) =>
    request<AccountConnectionDto>('DELETE', `/api/connections/${encodeURIComponent(id)}`)
};
