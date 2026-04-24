'use client';

import {
  MutationCache,
  QueryClient,
  QueryClientProvider as TanstackQueryClientProvider
} from '@tanstack/react-query';
import * as React from 'react';

import { ensureFreshElectronSession } from '@/lib/electron-auth/ensure-session';

function makeQueryClient() {
  return new QueryClient({
    mutationCache: new MutationCache({
      onMutate: () => ensureFreshElectronSession()
    }),
    defaultOptions: {
      queries: {
        // Server-rendered bootstraps provide fresh initialData; we don't want
        // an aggressive background refetch to clobber it before components
        // have finished hydrating. Phase 3 will tune per-query when real
        // transports land.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1
      },
      mutations: {
        retry: 0
      }
    }
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function AppQueryClientProvider({ children }: { children: React.ReactNode }) {
  const client = getQueryClient();
  return <TanstackQueryClientProvider client={client}>{children}</TanstackQueryClientProvider>;
}
