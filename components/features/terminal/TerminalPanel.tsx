'use client';

import { Terminal as TerminalIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { EmbeddedTerminal } from './EmbeddedTerminal';
import { useTerminal } from './TerminalProvider';

export function TerminalPanel() {
  const { isElectron, isTerminalOpen, activeTerminalId, closeTerminal, terminalMode } =
    useTerminal();

  if (!isElectron || !isTerminalOpen || terminalMode !== 'embedded') {
    return null;
  }

  return (
    <div className="border-t bg-background" style={{ height: 320 }}>
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TerminalIcon className="h-3.5 w-3.5" />
          Terminal
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={closeTerminal}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="h-[calc(100%-33px)]">
        <EmbeddedTerminal terminalId={activeTerminalId} />
      </div>
    </div>
  );
}
