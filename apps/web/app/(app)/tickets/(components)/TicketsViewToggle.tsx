'use client';

import { CalendarDays, LayoutGrid, List } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { setViewPreferenceAction } from '@/lib/actions/view-preference';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { refreshElectronRoute } from '@/lib/electron-auth/route-refresh';

const upsertProjectUserPreferencesActionWithRetry = withElectronActionRetry(
  upsertProjectUserPreferencesAction
);
const setViewPreferenceActionWithRetry = withElectronActionRetry(setViewPreferenceAction);

export default function TicketsViewToggle({
  initialView,
  projectId
}: {
  initialView: string;
  projectId?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticView, setOptimisticView] = useOptimistic(initialView);

  function onValueChange(nextView: string) {
    startTransition(async () => {
      setOptimisticView(nextView);
      if (projectId) {
        await upsertProjectUserPreferencesActionWithRetry(projectId, {
          preferred_view: nextView
        });
      } else {
        await setViewPreferenceActionWithRetry(nextView);
      }
      await refreshElectronRoute(router);
    });
  }

  return (
    <>
      <Tabs value={optimisticView} onValueChange={onValueChange} className="hidden md:flex">
        <TabsList>
          <TabsTrigger value="board" title="Board view">
            <LayoutGrid className="size-4" />
            Board
          </TabsTrigger>
          <TabsTrigger value="list" title="List view">
            <List className="size-4" />
            List
          </TabsTrigger>
          <TabsTrigger value="calendar" title="Calendar view">
            <CalendarDays className="size-4" />
            Calendar
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 md:hidden"
            aria-label={`Current view: ${optimisticView === 'calendar' ? 'Calendar' : 'List'}`}
            title={`Current view: ${optimisticView === 'calendar' ? 'Calendar' : 'List'}`}
          >
            {optimisticView === 'calendar' ? (
              <CalendarDays className="h-4 w-4" />
            ) : (
              <List className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup
            value={optimisticView === 'calendar' ? 'calendar' : 'list'}
            onValueChange={nextView => onValueChange(nextView)}
          >
            <DropdownMenuRadioItem value="list" className="gap-2">
              <List className="h-4 w-4" />
              List
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="calendar" className="gap-2">
              <CalendarDays className="h-4 w-4" />
              Calendar
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
