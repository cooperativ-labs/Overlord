import type {
  CreateUserTokenBody,
  CreateUserTokenResultDto,
  UpdateUserTokenBody,
  UserTokenDto
} from '../../../shared/contract.ts';

import { request } from './request.ts';

export const userTokensApi = {
  listUserTokens: () => request<UserTokenDto[]>('GET', '/api/user-tokens'),
  createUserToken: (body: CreateUserTokenBody) =>
    request<CreateUserTokenResultDto>('POST', '/api/user-tokens', body),
  renameUserToken: (id: string, body: UpdateUserTokenBody) =>
    request<UserTokenDto>('PATCH', `/api/user-tokens/${id}`, body),
  revokeUserToken: (id: string) => request<UserTokenDto>('POST', `/api/user-tokens/${id}/revoke`),
  deleteRevokedUserToken: (id: string) => request<void>('DELETE', `/api/user-tokens/${id}`)
};
