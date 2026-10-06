import type {
  AccountConnectionListResponse,
  AccountConnectionProvider,
  SetAccountConnectionApiKeyBody,
  UpdateAccountConnectionBody
} from '@overlord/contract';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.ts';
import {
  invalidateMissionEverhourQueries,
  invalidateProjectEverhourQueries
} from '../query-invalidation.ts';
import { keys } from '../query-keys.ts';

/** Every connected account plus provider availability (`GET /api/connections?scope=all`). */
export const useAccountConnections = () =>
  useQuery({
    queryKey: keys.accountConnections,
    queryFn: () => api.listAllAccountConnections(),
    // Sign-in finishes in another tab or the system browser.
    refetchOnWindowFocus: true
  });

/** Refresh every surface that depends on a connection after it changes. */
export function invalidateAfterConnectionChange(
  qc: QueryClient,
  provider: AccountConnectionProvider
): Promise<void> {
  if (provider === 'everhour') {
    invalidateMissionEverhourQueries(qc);
    invalidateProjectEverhourQueries(qc);
  }
  if (provider === 'knowledgebase') {
    void qc.invalidateQueries({
      predicate: query => query.queryKey[0] === 'chat' && query.queryKey[2] === 'providers'
    });
  }
  return qc.invalidateQueries({ queryKey: keys.accountConnections });
}

export function useSetAccountConnectionApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAccountConnectionApiKeyBody) => api.setAccountConnectionApiKey(body),
    onSuccess: (_data, body) => invalidateAfterConnectionChange(qc, body.provider)
  });
}

/** Change a Knowledgebase connection's settings (v158), revision-checked. */
export function useUpdateAccountConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateAccountConnectionBody }) =>
      api.updateAccountConnection(input.id, input.body),
    onSettled: () => invalidateAfterConnectionChange(qc, 'knowledgebase')
  });
}

export function useDisconnectAccountConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; provider: AccountConnectionProvider }) =>
      api.disconnectAccountConnection(input.id),
    onSuccess: (_data, input) => invalidateAfterConnectionChange(qc, input.provider)
  });
}

/**
 * Start an OAuth sign-in. The callback returns to Connected accounts, or to
 * `returnPath` for providers that accept one (GitHub).
 */
export function useStartAccountConnection() {
  return useMutation({
    mutationFn: (input: { provider: AccountConnectionProvider; returnPath?: string }) =>
      api.startAccountConnection({
        provider: input.provider,
        returnTo: 'web',
        ...(input.provider !== 'knowledgebase' && input.returnPath
          ? { returnPath: input.returnPath }
          : {})
      })
  });
}

function everhourIntegration(list: AccountConnectionListResponse) {
  const connection = list.items.find(
    item => item.provider === 'everhour' && item.state === 'connected'
  );
  return { connected: Boolean(connection), accountName: connection?.account?.label ?? null };
}

/**
 * The caller's Everhour connection, derived from Connected accounts. Gates every
 * Everhour feature surface (timers, project links).
 */
export const useEverhourIntegration = () =>
  useQuery({
    queryKey: keys.accountConnections,
    queryFn: () => api.listAllAccountConnections(),
    select: everhourIntegration
  });
