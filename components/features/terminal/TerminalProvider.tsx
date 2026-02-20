'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useElectron } from './useElectron';

type TerminalMode = 'embedded' | 'external';

type TerminalContextValue = {
  isElectron: boolean;
  terminalMode: TerminalMode;
  setTerminalMode: (mode: TerminalMode) => void;
  sendCommand: (command: string) => Promise<void>;
  isTerminalOpen: boolean;
  activeTerminalId: string | null;
  closeTerminal: () => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { api, isElectron } = useElectron();
  const [terminalMode, setTerminalModeState] = useState<TerminalMode>('embedded');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

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
    async (command: string) => {
      if (!api) return;

      if (terminalMode === 'external') {
        await api.terminal.openExternal(command);
        return;
      }

      // Embedded mode
      if (activeTerminalId) {
        // Write command to existing terminal
        api.terminal.write(activeTerminalId, command + '\r');
      } else {
        // Spawn a new terminal with the command
        const id = await api.terminal.spawn(command);
        setActiveTerminalId(id);
      }
    },
    [api, terminalMode, activeTerminalId]
  );

  const closeTerminal = useCallback(async () => {
    if (!api || !activeTerminalId) return;
    await api.terminal.kill(activeTerminalId);
    setActiveTerminalId(null);
  }, [api, activeTerminalId]);

  return (
    <TerminalContext.Provider
      value={{
        isElectron,
        terminalMode,
        setTerminalMode,
        sendCommand,
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
