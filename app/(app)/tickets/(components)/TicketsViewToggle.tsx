'use client';

import { LayoutGrid, List } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { upsertProjectUserPreferencesAction } from '@/lib/actions/project-user-preferences';
import { setViewPreferenceAction } from '@/lib/actions/view-preference';

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
        await upsertProjectUserPreferencesAction(projectId, { preferred_view: nextView });
      } else {
        await setViewPreferenceAction(nextView);
      }
      router.refresh();
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
      </TabsList>
    </Tabs>
  );
}
