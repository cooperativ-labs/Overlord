'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useElectron } from './useElectron';

type TerminalMode = 'embedded' | 'external';

type TerminalContextValue = {
  isElectron: boolean;
  terminalMode: TerminalMode;
  setTerminalMode: (mode: TerminalMode) => void;
  sendCommand: (command: string, options?: { cwd?: string }) => Promise<void>;
  launchAgent: (
    ticketId: string,
    agent: 'claude' | 'codex',
    cwd?: string,
    agentToken?: string
  ) => Promise<void>;
  isTerminalOpen: boolean;
  activeTerminalId: string | null;
  closeTerminal: () => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { api, isElectron } = useElectron();
  const [terminalMode, setTerminalModeState] = useState<TerminalMode>('embedded');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [activeTerminalCwd, setActiveTerminalCwd] = useState<string | null>(null);

  // Load saved terminal mode on mount
  useEffect(() => {
    if (api) {
      api.settings.get<TerminalMode>('terminalMode').then(mode => {
        if (mode) setTerminalModeState(mode);
      });
    }
  }, [api]);

  const setTerminalMode = useCallback(
    (mode: TerminalMode) => {
      setTerminalModeState(mode);
      api?.settings.set('terminalMode', mode);
    },
    [api]
  );

  const sendCommand = useCallback(
    async (command: string, options?: { cwd?: string }) => {
      if (!api) return;
      const cwd = options?.cwd?.trim() || undefined;

      if (terminalMode === 'external') {
        await api.terminal.openExternal(command, cwd);
        return;
      }

      // Embedded mode
      if (activeTerminalId) {
        if (cwd && cwd !== activeTerminalCwd) {
          api.terminal.write(activeTerminalId, `cd ${shellQuote(cwd)}\r`);
          setActiveTerminalCwd(cwd);
          // Wait for cd to complete before writing the next command
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        // Write command to existing terminal
        api.terminal.write(activeTerminalId, command + '\r');
      } else {
        // Spawn a new terminal with the command
        const id = await api.terminal.spawn(command, cwd);
        setActiveTerminalId(id);
        setActiveTerminalCwd(cwd ?? null);
      }
    },
    [api, terminalMode, activeTerminalId, activeTerminalCwd]
  );

  const launchAgent = useCallback(
    async (ticketId: string, agent: 'claude' | 'codex', cwd?: string, agentToken?: string) => {
      if (!api) return;
      const result = await api.terminal.launchAgent(ticketId, agent, cwd, agentToken);
      // If we got a terminal ID back (embedded mode), track it
      if (typeof result === 'string') {
        setActiveTerminalId(result);
        setActiveTerminalCwd(cwd ?? null);
      }
    },
    [api]
  );

  const closeTerminal = useCallback(async () => {
    if (!api || !activeTerminalId) return;
    await api.terminal.kill(activeTerminalId);
    setActiveTerminalId(null);
    setActiveTerminalCwd(null);
  }, [api, activeTerminalId]);

  return (
    <TerminalContext.Provider
      value={{
        isElectron,
        terminalMode,
        setTerminalMode,
        sendCommand,
        launchAgent,
        isTerminalOpen: activeTerminalId !== null,
        activeTerminalId,
        closeTerminal
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
