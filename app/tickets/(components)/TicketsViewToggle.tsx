'use client';

import { LayoutGrid, List } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function TicketsViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get('view') ?? 'board';

  function onValueChange(nextView: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Tabs value={view} onValueChange={onValueChange}>
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
