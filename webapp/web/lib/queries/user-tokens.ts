import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CreateUserTokenBody, UpdateUserTokenBody } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { keys } from '../query-keys.ts';

export const useUserTokens = () =>
  useQuery({ queryKey: keys.userTokens, queryFn: api.listUserTokens });

export function useCreateUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTokenBody) => api.createUserToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useRenameUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserTokenBody }) =>
      api.renameUserToken(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useRevokeUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.revokeUserToken(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}

export function useDeleteRevokedUserToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRevokedUserToken(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.userTokens })
  });
}
