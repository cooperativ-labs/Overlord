'use client';

import { useEffect, useRef } from 'react';

import { useElectron } from './useElectron';

type Props = {
  terminalId: string | null;
};

export function EmbeddedTerminal({ terminalId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { api } = useElectron();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !api || !terminalId || initializedRef.current) return;
    initializedRef.current = true;

    let cleanup: (() => void) | undefined;

    async function init() {
      // Dynamic imports for xterm (only available client-side)
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      if (!containerRef.current || !api) return;

      const term = new Terminal({
        theme: {
          background: '#0a0a0a',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          selectionBackground: '#264f78'
        },
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        cursorBlink: true,
        scrollback: 5000
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      // Pipe keyboard input to PTY
      term.onData((data) => {
        api!.terminal.write(terminalId!, data);
      });

      // Pipe PTY output to xterm
      const removeDataListener = api!.terminal.onData((id, data) => {
        if (id === terminalId) {
          term.write(data);
        }
      });

      // Handle process exit
      const removeExitListener = api!.terminal.onExit((id, code) => {
        if (id === terminalId) {
          term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        }
      });

      // Handle resize
      const observer = new ResizeObserver(() => {
        fitAddon.fit();
        api!.terminal.resize(terminalId!, term.cols, term.rows);
      });
      observer.observe(containerRef.current!);

      cleanup = () => {
        observer.disconnect();
        removeDataListener();
        removeExitListener();
        term.dispose();
        initializedRef.current = false;
      };
    }

    init();

    return () => {
      cleanup?.();
    };
  }, [api, terminalId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
