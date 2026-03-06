'use client';

import { Plus, Terminal as TerminalIcon, X } from 'lucide-react';
import { Fragment } from 'react';

import { Button } from '@/components/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

import { EmbeddedTerminal } from './EmbeddedTerminal';
import { useTerminal } from './TerminalProvider';

export function TerminalPanel() {
  const {
    isElectron,
    isTerminalVisible,
    terminalIds,
    activeTerminalId,
    toggleTerminal,
    closeTerminalById,
    openTerminal,
    terminalMode
  } = useTerminal();

  if (!isElectron || !isTerminalVisible || terminalMode !== 'embedded') {
    return null;
  }

  const defaultSize = terminalIds.length > 0 ? `${100 / terminalIds.length}%` : '100%';

  return (
    <div className="flex h-full min-h-0 flex-col border-t bg-background">
      <div className="flex items-center justify-between px-3 bg-black/80">
        <div className="flex items-center gap-2 text-xs text-muted">
          <TerminalIcon className="h-3 w-3" />
          Terminal
        </div>
        <div className="flex items-center gap-1 text-muted">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            title="New terminal tab"
            onClick={() => void openTerminal()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => void toggleTerminal()}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0 w-full">
          {terminalIds.map((terminalId, index) => (
            <Fragment key={terminalId}>
              {index > 0 ? <ResizableHandle withHandle /> : null}
              <ResizablePanel defaultSize={defaultSize} minSize="20%">
                <div className="flex h-full min-h-0 flex-col">
                  <div
                    className={cn(
                      'flex items-center justify-end border-b border-white/10 px-2 pr-4 ',
                      activeTerminalId === terminalId
                        ? 'bg-black/90 text-muted'
                        : 'bg-black/50 text-muted'
                    )}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-4 w-4 text-muted"
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
