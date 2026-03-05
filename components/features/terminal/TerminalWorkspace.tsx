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
    <div className="flex flex-1 min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical" className="flex flex-1 min-h-0 flex-col">
        <ResizablePanel
          defaultSize="72%"
          minSize="35%"
          className="flex flex-col overflow-y-scroll h-full"
        >
          {children}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="28%" minSize="3%" maxSize="65%">
          <TerminalPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
