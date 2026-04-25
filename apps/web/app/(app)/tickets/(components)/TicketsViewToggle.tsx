'use client';

import { CalendarDays, LayoutGrid, List } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

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
    <Tabs value={optimisticView} onValueChange={onValueChange}>
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
  );
}
