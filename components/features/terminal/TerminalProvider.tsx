'use client';

import { createContext, type ReactNode, useCallback, useContext } from 'react';

import { useElectron } from './useElectron';

type TerminalContextValue = {
  isElectron: boolean;
  launchAgent: (
    ticketId: string,
    agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
    cwd?: string,
    agentToken?: string,
    launchMode?: 'run' | 'ask',
    flags?: string[]
  ) => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { api, isElectron } = useElectron();

  const launchAgent = useCallback(
    async (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
      cwd?: string,
      agentToken?: string,
      launchMode: 'run' | 'ask' = 'run',
      flags?: string[]
    ) => {
      if (!api) return;
      await api.terminal.launchAgent(ticketId, agent, cwd, agentToken, launchMode, flags);
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
