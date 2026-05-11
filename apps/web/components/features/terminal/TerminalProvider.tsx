'use client';

import { createContext, type ReactNode, useCallback, useContext } from 'react';

import type { LaunchTerminalAgentParams } from '@/types/electron';

import { useElectron } from './useElectron';

type TerminalContextValue = {
  isElectron: boolean;
  launchAgent: (params: LaunchTerminalAgentParams) => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { api, isElectron } = useElectron();

  const launchAgent = useCallback(
    async (params: LaunchTerminalAgentParams) => {
      if (!api) return;
      await api.terminal.launchAgent(params);
    },
    [api]
  );

  return (
    <TerminalContext.Provider
      value={{
        isElectron,
        launchAgent
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return ctx;
}
