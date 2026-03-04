'use client';

import type { ReactNode } from 'react';

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';

import { TerminalPanel } from './TerminalPanel';
import { useTerminal } from './TerminalProvider';

type TerminalWorkspaceProps = {
  children: ReactNode;
};

export function TerminalWorkspace({ children }: TerminalWorkspaceProps) {
  const { isElectron, isTerminalOpen, terminalMode } = useTerminal();
  const showEmbeddedTerminal = isElectron && isTerminalOpen && terminalMode === 'embedded';

  if (!showEmbeddedTerminal) {
    return (
      <>
        {children}
        <TerminalPanel />
      </>
    );
  }

  // react-resizable-panels v4 treats bare numbers as pixels, not percentages.
  // Use string values with "%" suffix for percentage-based sizing.
  return (
    <div className="relative min-h-0 flex-1">
      <ResizablePanelGroup orientation="vertical" className="absolute inset-0">
        <ResizablePanel defaultSize="72%" minSize="35%">
          {children}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="28%" minSize="5%" maxSize="65%">
          <TerminalPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
