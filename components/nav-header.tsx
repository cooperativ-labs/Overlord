'use client';

import { useEffect, useState } from 'react';

import { EverhourNavTimer } from '@/components/features/everhour/EverhourNavTimer';
import { NewTicketButton } from '@/components/features/NewTicketButton';
import { TicketSearch } from '@/components/nav-header/TicketSearch';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

export function NavHeader() {
  const [hasEverhourIntegration, setHasEverhourIntegration] = useState(false);

  useEffect(() => {
    getEverhourConnectionStatus().then(status => setHasEverhourIntegration(status.connected));
  }, []);

  return (
    <header className=" electron-drag-region flex flex-row justify-between dark:rounded-lg items-center gap-2 border-b bg-card px-4 py-2 text-card-foreground">
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
        <NewTicketButton />
      </div>
    </header>
  );
}
