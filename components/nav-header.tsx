'use client';

import { Terminal } from 'lucide-react';

import { NewTicketButton } from '@/components/features/NewTicketButton';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { TicketSearch } from '@/components/nav-header/TicketSearch';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';

export function NavHeader() {
  const { isElectron, toggleTerminal, terminalMode } = useTerminal();
  const showTerminalToggle = isElectron && terminalMode === 'embedded';

  return (
    <header className="electron-drag-region flex flex-row items-center gap-2 border-b bg-card px-4 py-2 text-card-foreground">
      <div className="flex shrink-0 items-center">
        <SidebarTrigger className="-ml-1 electron-no-drag" />
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <div className="electron-no-drag min-w-0 w-full max-w-xl">
          <TicketSearch />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 electron-no-drag">
        {showTerminalToggle ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void toggleTerminal()}
            aria-label="Toggle terminal"
            title="Toggle terminal (Ctrl+`)"
          >
            <Terminal className="h-4 w-4" />
          </Button>
        ) : null}
        <NewTicketButton />
      </div>
    </header>
  );
}
