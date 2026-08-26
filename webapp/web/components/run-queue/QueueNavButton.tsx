import { useParams } from '@tanstack/react-router';
import { ListOrdered } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet.tsx';
import { useAllProjects, useMeta, useProjectRunQueues } from '@/lib/queries.ts';
import { cn } from '@/lib/utils.ts';

import { RunQueuePanel } from './RunQueuePanel.tsx';

/**
 * The single Run Queue entry point. It lives in the nav header so the queue is
 * reachable from every route, and opens the same queue UI the dedicated queue
 * page used to render.
 */
export function QueueNavButton() {
  const [open, setOpen] = useState(false);
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const meta = useMeta();
  const projects = useAllProjects();
  const resolvedProjectId =
    projectId ?? meta.data?.defaultProjectId ?? projects.data?.[0]?.id ?? null;
  const queues = useProjectRunQueues(resolvedProjectId ?? '');
  /* Green means the queue is doing something right now: an entry has been
   * dispatched (launching) or has a live session (executing). */
  const hasActiveEntry = Boolean(
    queues.data?.queues.some(queue =>
      queue.entries.some(entry => entry.state === 'dispatched' || entry.state === 'running')
    )
  );

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={cn(
          'h-8 shrink-0 px-0 md:w-auto md:px-2.5',
          hasActiveEntry && 'text-emerald-600 dark:text-emerald-400'
        )}
        onClick={() => setOpen(true)}
        disabled={!resolvedProjectId}
        aria-label="Run Queue"
        title="Run Queue"
      >
        <ListOrdered />
        <span className="hidden md:inline">Queue</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-96"
        >
          <SheetHeader>
            <SheetTitle>Run Queue</SheetTitle>
            <SheetDescription>
              Objectives launch in order within each queue. Running entries stay fixed.
            </SheetDescription>
          </SheetHeader>
          {resolvedProjectId ? (
            <div className="px-4 pb-4">
              <RunQueuePanel projectId={resolvedProjectId} compact />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
