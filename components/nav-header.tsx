'use client';

import { Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { EverhourNavTimer } from '@/components/features/everhour/EverhourNavTimer';
import { NewTicketButton } from '@/components/features/NewTicketButton';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { TicketSearch } from '@/components/nav-header/TicketSearch';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

export function NavHeader() {
  const { isElectron, toggleTerminal, terminalMode } = useTerminal();
  const showTerminalToggle = isElectron && terminalMode === 'embedded';

  const [hasEverhourIntegration, setHasEverhourIntegration] = useState(false);

  useEffect(() => {
    getEverhourConnectionStatus().then(status => setHasEverhourIntegration(status.connected));
  }, []);

  return (
    <header className=" electron-drag-region flex flex-row justify-between items-center gap-2 border-b bg-card px-4 py-2 text-card-foreground">
      <div className="flex shrink-0 items-center">
        <SidebarTrigger className="-ml-1 electron-no-drag" />
      </div>
      <div className="flex justify-center min-w-0 flex-1 px-2">
        <div className="electron-no-drag min-w-0 w-full max-w-xl">
          <TicketSearch />
        </div>
      </div>
      <div className="flex justify-end items-center gap-3 electron-no-drag ">
        <div className="hidden md:block w-18 ">
          {hasEverhourIntegration && <EverhourNavTimer />}
        </div>
        {showTerminalToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
