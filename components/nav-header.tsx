'use client';

import { RefreshCwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { EverhourNavTimer } from '@/components/features/everhour/EverhourNavTimer';
import { NewTicketButton } from '@/components/features/NewTicketButton';
import { useElectron } from '@/components/features/terminal/useElectron';
import { TicketSearch } from '@/components/nav-header/TicketSearch';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

export function NavHeader() {
  const [hasEverhourIntegration, setHasEverhourIntegration] = useState(false);
  const [isStandalonePwa, setIsStandalonePwa] = useState(false);
  const [hardRefreshButtonState, setHardRefreshButtonState] =
    useState<ButtonLoadingState>('default');
  const { api, isElectron } = useElectron();

  useEffect(() => {
    getEverhourConnectionStatus().then(status => setHasEverhourIntegration(status.connected));
  }, []);

  useEffect(() => {
    if (isElectron) return;

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const updateStandaloneState = () => {
      setIsStandalonePwa(
        mediaQuery.matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
      );
    };

    updateStandaloneState();
    mediaQuery.addEventListener('change', updateStandaloneState);
    return () => mediaQuery.removeEventListener('change', updateStandaloneState);
  }, [isElectron]);

  const showRefreshButton = isElectron || isStandalonePwa;

  const handleHardRefresh = async () => {
    setHardRefreshButtonState('loading');

    // Give the browser a paint opportunity so the loading spinner becomes visible.
    await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));

    try {
      if (isElectron) {
        if (!api?.app?.reload) {
          throw new Error('Hard refresh is unavailable.');
        }

        const reloaded = await api.app.reload();
        if (!reloaded) {
          throw new Error('Hard refresh failed.');
        }
        return;
      }

      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(registration => registration.update()));
        } catch {
          // Continue with the refresh even if service worker updates fail.
        }
      }

      const refreshUrl = new URL(window.location.href);
      refreshUrl.searchParams.set('_refresh', Date.now().toString());
      window.location.replace(refreshUrl.toString());
    } catch {
      setHardRefreshButtonState('error');
    }
  };

  return (
    <header className=" electron-drag-region flex flex-row justify-between dark:rounded-lg items-center gap-2 border-b bg-card px-4 py-2 text-card-foreground">
      <div className="flex shrink-0 items-center gap-1">
        <SidebarTrigger className="-ml-1 electron-no-drag" />
        {showRefreshButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <LoadingButton
                type="button"
                variant="ghost"
                size="icon"
                className="electron-no-drag"
                buttonState={hardRefreshButtonState}
                setButtonState={setHardRefreshButtonState}
                onClick={() => void handleHardRefresh()}
                aria-label="Hard refresh app"
                text={<RefreshCwIcon className="size-4" />}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">Hard refresh app</TooltipContent>
          </Tooltip>
        ) : null}
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
