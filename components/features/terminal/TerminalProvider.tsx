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
    agent: 'claude' | 'codex' | 'cursor' | 'gemini',
    cwd?: string,
    agentToken?: string,
    launchMode?: 'run' | 'ask',
    flags?: string[]
  ) => Promise<void>;
  isTerminalOpen: boolean;
  terminalIds: string[];
  activeTerminalId: string | null;
  openTerminal: () => Promise<void>;
  toggleTerminal: () => Promise<void>;
  closeTerminal: () => Promise<void>;
  closeTerminalById: (id: string) => Promise<void>;
};

const TerminalContext = createContext<TerminalContextValue | null>(null);

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appendUniqueTerminalId(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids;
  return [...ids, id];
}

export function TerminalProvider({ children }: { children: ReactNode }) {
  const { api, isElectron } = useElectron();
  const [terminalMode, setTerminalModeState] = useState<TerminalMode>('embedded');
  const [terminalIds, setTerminalIds] = useState<string[]>([]);
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
      const targetTerminalId = activeTerminalId ?? terminalIds[terminalIds.length - 1] ?? null;
      if (targetTerminalId) {
        if (cwd && cwd !== activeTerminalCwd) {
          api.terminal.write(targetTerminalId, `cd ${shellQuote(cwd)}\r`);
          setActiveTerminalCwd(cwd);
          // Wait for cd to complete before writing the next command
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        // Write command to existing terminal
        api.terminal.write(targetTerminalId, command + '\r');
        setActiveTerminalId(targetTerminalId);
      } else {
        // Spawn a new terminal with the command
        const id = await api.terminal.spawn(command, cwd);
        setTerminalIds(previous => appendUniqueTerminalId(previous, id));
        setActiveTerminalId(id);
        setActiveTerminalCwd(cwd ?? null);
      }
    },
    [api, terminalMode, activeTerminalId, activeTerminalCwd, terminalIds]
  );

  const launchAgent = useCallback(
    async (
      ticketId: string,
      agent: 'claude' | 'codex' | 'cursor' | 'gemini',
      cwd?: string,
      agentToken?: string,
      launchMode: 'run' | 'ask' = 'run',
      flags?: string[]
    ) => {
      if (!api) return;
      const result = await api.terminal.launchAgent(
        ticketId,
        agent,
        cwd,
        agentToken,
        launchMode,
        flags
      );
      // If we got a terminal ID back (embedded mode), track it
      if (typeof result === 'string') {
        setTerminalIds(previous => appendUniqueTerminalId(previous, result));
        setActiveTerminalId(result);
        setActiveTerminalCwd(cwd ?? null);
      }
    },
    [api]
  );

  const openTerminal = useCallback(async () => {
    if (!api || terminalMode !== 'embedded' || terminalIds.length > 0) return;
    const id = await api.terminal.spawn();
    setTerminalIds(previous => appendUniqueTerminalId(previous, id));
    setActiveTerminalId(id);
    setActiveTerminalCwd(null);
  }, [api, terminalMode, terminalIds]);

  const closeTerminalById = useCallback(
    async (id: string) => {
      if (!api) return;
      await api.terminal.kill(id);
      setTerminalIds(previous => {
        const next = previous.filter(terminalId => terminalId !== id);
        setActiveTerminalId(current => {
          if (current !== id) return current;
          setActiveTerminalCwd(null);
          return next.length > 0 ? (next[next.length - 1] ?? null) : null;
        });
        return next;
      });
    },
    [api]
  );

  const closeTerminal = useCallback(async () => {
    if (!api || terminalIds.length === 0) return;
    await Promise.all(terminalIds.map(id => api.terminal.kill(id)));
    setTerminalIds([]);
    setActiveTerminalId(null);
    setActiveTerminalCwd(null);
  }, [api, terminalIds]);

  const toggleTerminal = useCallback(async () => {
    if (terminalIds.length > 0) {
      await closeTerminal();
      return;
    }
    await openTerminal();
  }, [terminalIds, closeTerminal, openTerminal]);

  useEffect(() => {
    if (!isElectron || terminalMode !== 'embedded') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== '`') return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox')
      ) {
        return;
      }

      event.preventDefault();
      void toggleTerminal();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isElectron, terminalMode, toggleTerminal]);

  return (
    <TerminalContext.Provider
      value={{
        isElectron,
        terminalMode,
        setTerminalMode,
        sendCommand,
        launchAgent,
        isTerminalOpen: terminalIds.length > 0,
        terminalIds,
        activeTerminalId,
        openTerminal,
        toggleTerminal,
        closeTerminal,
        closeTerminalById
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
