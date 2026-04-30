'use client';

import { CalendarDays, LayoutGrid, List } from 'lucide-react';

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

import { useTicketView } from './TicketViewContext';

const upsertProjectUserPreferencesActionWithRetry = withElectronActionRetry(
  upsertProjectUserPreferencesAction
);
const setViewPreferenceActionWithRetry = withElectronActionRetry(setViewPreferenceAction);

export default function TicketsViewToggle({
  initialView: _initialView,
  projectId
}: {
  initialView: string;
  projectId?: string;
}) {
  const { activeView, setActiveView } = useTicketView();

  function onValueChange(nextView: string) {
    // Update client view state immediately — no route refresh needed.
    setActiveView(nextView);

    // Persist preference in the background without blocking the UI swap.
    if (projectId) {
      upsertProjectUserPreferencesActionWithRetry(projectId, { preferred_view: nextView });
    } else {
      setViewPreferenceActionWithRetry(nextView);
    }
  }

  return (
    <>
      <Tabs value={activeView} onValueChange={onValueChange} className="hidden md:flex">
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
            aria-label={`Current view: ${activeView === 'calendar' ? 'Calendar' : 'List'}`}
            title={`Current view: ${activeView === 'calendar' ? 'Calendar' : 'List'}`}
          >
            {activeView === 'calendar' ? (
              <CalendarDays className="h-4 w-4" />
            ) : (
              <List className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup
            value={activeView === 'calendar' ? 'calendar' : 'list'}
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
