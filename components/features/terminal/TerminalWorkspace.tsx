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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel defaultSize={72} minSize={35}>
          {children}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={28} minSize={15} maxSize={65}>
          <TerminalPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
