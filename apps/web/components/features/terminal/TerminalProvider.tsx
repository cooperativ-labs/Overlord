'use client';

import { createContext, type ReactNode, useCallback, useContext } from 'react';

import { useElectron } from './useElectron';

type TerminalContextValue = {
  isElectron: boolean;
  launchAgent: (
    ticketId: string,
    agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode',
    cwd?: string,
    launchMode?: 'run' | 'ask',
    flags?: string[],
    model?: string,
    thinking?: string,
    sshCommand?: string,
    remoteWorkingDirectory?: string
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
      launchMode: 'run' | 'ask' = 'run',
      flags?: string[],
      model?: string,
      thinking?: string,
      sshCommand?: string,
      remoteWorkingDirectory?: string
    ) => {
      if (!api) return;
      await api.terminal.launchAgent(
        ticketId,
        agent,
        cwd,
        launchMode,
        flags,
        model,
        thinking,
        sshCommand,
        remoteWorkingDirectory
      );
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
