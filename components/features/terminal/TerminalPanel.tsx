'use client';

import { Terminal as TerminalIcon, X } from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

import { EmbeddedTerminal } from './EmbeddedTerminal';
import { useTerminal } from './TerminalProvider';

export function TerminalPanel() {
  const {
    isElectron,
    isTerminalOpen,
    terminalIds,
    activeTerminalId,
    closeTerminal,
    closeTerminalById,
    terminalMode
  } = useTerminal();

  if (!isElectron || !isTerminalOpen || terminalMode !== 'embedded') {
    return null;
  }

  const defaultSize = terminalIds.length > 0 ? 100 / terminalIds.length : 100;

  return (
    <div className="flex h-full min-h-0 flex-col border-t bg-background">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TerminalIcon className="h-3.5 w-3.5" />
          Terminal
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => void closeTerminal()}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 w-full">
          {terminalIds.map((terminalId, index) => (
            <Fragment key={terminalId}>
              {index > 0 ? <ResizableHandle withHandle /> : null}
              <ResizablePanel defaultSize={defaultSize} minSize={20}>
                <div className="flex h-full min-h-0 flex-col">
                  <div
                    className={cn(
                      'flex items-center justify-end border-b px-2 py-1',
                      activeTerminalId === terminalId ? 'bg-muted/60' : 'bg-muted/30'
                    )}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      title="Close terminal session"
                      onClick={() => void closeTerminalById(terminalId)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <EmbeddedTerminal terminalId={terminalId} />
                  </div>
                </div>
              </ResizablePanel>
            </Fragment>
          ))}
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
